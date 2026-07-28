export const FORMAT_VERSION = "cd-ts-1";
export const DEFAULT_CONFIG = { minimum_deck_size: 20, maximum_deck_size: 30, starting_hand_size: 5, victory_points_to_win: 20, simulations_per_match: 1000, maximum_actions_per_battle: 100000 };
export class Rng {
    state;
    constructor(state) {
        this.state = state;
    }
    next() { this.state = (this.state + 0x6D2B79F5) >>> 0; let t = this.state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
    int(max) { return Math.floor(this.next() * max); }
    shuffle(items) { for (let i = items.length - 1; i > 0; i--) {
        const j = this.int(i + 1);
        [items[i], items[j]] = [items[j], items[i]];
    } return items; }
}
const OPERATORS = ["<", "<=", "=", ">=", ">"];
const compare = (value, operator, threshold) => operator === "<" ? value < threshold : operator === "<=" ? value <= threshold : operator === "=" ? value === threshold : operator === ">=" ? value >= threshold : value > threshold;
export function validateSubmission(s, cards, config = DEFAULT_CONFIG) { const size = Object.values(s.decklist).reduce((a, b) => a + b, 0); if (size < config.minimum_deck_size || size > config.maximum_deck_size)
    throw Error(`${s.name}: deck has ${size} cards; allowed size is ${config.minimum_deck_size}-${config.maximum_deck_size}.`); for (const [id, count] of Object.entries(s.decklist))
    if (!cards[id] || !Number.isSafeInteger(count) || count <= 0)
        throw Error(`Invalid card quantity for ${id}.`); if (s.program.length > 10)
    throw Error("A program may contain at most 10 rules."); const reactions = s.reactions ?? []; if (!Array.isArray(reactions) || reactions.length > 10)
    throw Error("A reaction program may contain at most 10 rules."); if (s.default_action !== undefined && s.default_action !== "play_random_card" && s.default_action !== "end_turn")
    throw Error("Invalid default action."); if (s.random_card_ids?.some(id => !s.decklist[id]))
    throw Error("A random-card choice must be in the deck."); for (const rule of s.program) {
    if (!["if_able", "card_in_hand", "card_is", "quantity_compare", "own_victory_points_at_most", "opponent_victory_points_at_most", "opponent_sync_at_most", "opponent_victory_points_at_least"].includes(rule.condition_type))
        throw Error("Invalid rule condition.");
    if (!["play_named_card", "play_random_card", "end_turn"].includes(rule.action_type))
        throw Error("Invalid rule action.");
    if ((rule.condition_type === "card_in_hand" || rule.condition_type === "card_is") && (!rule.condition_card_id || !cards[rule.condition_card_id]))
        throw Error("Invalid card condition card.");
    if (rule.condition_type === "card_is" && rule.card_condition !== "in_your_hand" && rule.card_condition !== "on_your_side_of_board")
        throw Error("Invalid card condition.");
    if (rule.condition_type === "quantity_compare" && (!["cards_in_your_deck", "cards_in_your_hand", "cards_in_opponent_hand", "your_flux", "opponent_flux", "your_sync", "opponent_sync"].includes(rule.quantity ?? "") || !OPERATORS.includes(rule.comparison_operator ?? "<") || !Number.isSafeInteger(rule.quantity_threshold) || rule.quantity_threshold < 0))
        throw Error("Invalid quantity condition.");
    if (rule.action_type === "play_named_card" && (!rule.action_card_id || !cards[rule.action_card_id]))
        throw Error("Invalid named play card.");
} for (const rule of reactions)
    if (rule.trigger_type !== "opponent_would_gain_flux" || !OPERATORS.includes(rule.comparison_operator) || !Number.isSafeInteger(rule.quantity_threshold) || rule.quantity_threshold < 0 || !cards[rule.action_card_id] || cards[rule.action_card_id].card_kind !== "glitch")
        throw Error("Invalid reaction rule."); }
export class Battle {
    first;
    second;
    cards;
    config;
    rng;
    captureLog;
    log = [];
    actionCount = 0;
    turnCount = 0;
    extraTurns = [0, 0];
    winner;
    reason = "";
    active = 0;
    starting_player = 0;
    phase = "start";
    players;
    constructor(first, second, cards, config, rng, captureLog = true) {
        this.first = first;
        this.second = second;
        this.cards = cards;
        this.config = config;
        this.rng = rng;
        this.captureLog = captureLog;
        validateSubmission(first, cards, config);
        validateSubmission(second, cards, config);
        this.players = [this.player(first, "first"), this.player(second, "second")];
        for (const p of this.players) {
            this.randomize(p, p.deck);
            let drawn = 0;
            for (let i = 0; i < config.starting_hand_size; i++)
                drawn += Number(this.draw(p, false));
            if (drawn)
                this.note(`${p.id} | opening_hand`);
        }
    }
    player(s, id) { const deck = []; for (const [card_id, count] of Object.entries(s.decklist).sort(([a], [b]) => a.localeCompare(b)))
        for (let i = 0; i < count; i++)
            deck.push({ uid: `${id}:${card_id}:${i}`, definition: this.cards[card_id] }); return { id, program: s.program, reactions: s.reactions ?? [], deck, hand: [], discard: [], battlefield: [], points: 0, sync: 20, actions: 0, default_action: s.default_action ?? "play_random_card", random_card_ids: s.random_card_ids }; }
    opponent(p) { return this.players[0] === p ? this.players[1] : this.players[0]; }
    note(text) { if (this.captureLog)
        this.log.push(text); }
    act(p, text) { if (this.winner !== undefined)
        return false; this.actionCount++; p.actions++; this.note(text); if (this.actionCount > this.config.maximum_actions_per_battle) {
        const [a, b] = this.players;
        this.finish(a.actions === b.actions ? null : a.actions < b.actions ? a.id : b.id, a.actions === b.actions ? "action_limit_tie" : "action_limit");
        return false;
    } return true; }
    move(p, card, from, to, fromName, toName) { if (!from.includes(card) || !this.act(p, `move ${card.uid} from ${fromName} to ${toName}`))
        return false; from.splice(from.indexOf(card), 1); to.push(card); return true; }
    randomize(p, area) { this.act(p, "randomize deck"); this.rng.shuffle(area); }
    draw(p, narrate = true) { const c = p.deck[0]; if (!c) {
        this.note(`${p.id} | draw_failed`);
        this.finish(this.opponent(p).id, "deck_exhausted");
        return false;
    } const moved = this.move(p, c, p.deck, p.hand, "deck", "hand"); if (moved && narrate)
        this.note(`${p.id} | draw`); return moved; }
    changePoints(p, amount, source) { this.act(p, `change flux by ${amount}`); const before = p.points; p.points = Math.max(0, p.points + amount); const applied = p.points - before; if (applied)
        this.note(`${p.id} | flux:${applied}:${p.points}:${source ?? ""}`); }
    canPayFlux(p, amount) { return p.points >= Math.max(0, amount); }
    payFlux(p, amount) { const cost = Math.max(0, amount); if (!this.canPayFlux(p, cost))
        return false; if (cost === 0)
        return true; this.changePoints(p, -cost, "cost"); this.note(`${p.id} | flux_paid:${cost}`); return true; }
    canPlay(p, card) { return card.definition.card_kind !== "glitch" && this.phase === "main" && this.canPayFlux(p, card.definition.flux_cost ?? 0); }
    resolveSyncZeroTriggers(p) { const triggers = p.battlefield.filter(card => card.definition.mechanics?.some(mechanic => mechanic.type === "restore_sync_when_zero_and_delete_self")); for (const daemon of triggers) {
        const mechanic = daemon.definition.mechanics?.find(candidate => candidate.type === "restore_sync_when_zero_and_delete_self");
        if (!mechanic || !this.act(p, `resolve ${daemon.definition.card_id}`))
            return;
        if (p.sync === 0)
            this.setSync(p, mechanic.sync, daemon.definition.card_id);
        this.move(p, daemon, p.battlefield, p.discard, "battlefield", "discard");
    } }
    setSync(p, value, source) { if (!this.act(p, `set sync to ${value}`))
        return; const before = p.sync; p.sync = Math.max(0, value); const applied = p.sync - before; if (applied)
        this.note(`${p.id} | sync:${applied}:${p.sync}${source ? `:${source}` : ""}`); if (before > 0 && p.sync === 0)
        this.resolveSyncZeroTriggers(p); if (p.sync === 0)
        this.finish(this.opponent(p).id, "sync"); }
    changeSync(p, amount) { this.setSync(p, p.sync + amount); }
    preventersFor(event) { return this.opponent(event.recipient).battlefield.filter(card => card.definition.mechanics?.some(mechanic => mechanic.type === "prevent_next_opponent_flux_gain")); }
    playReaction(player, event) { for (const rule of player.reactions) {
        if (event.recipient === player)
            continue;
        const card = player.hand.find(instance => instance.definition.card_id === rule.action_card_id);
        if (!card || !card.definition.reaction_triggers?.includes(rule.trigger_type) || !compare(event.amount, rule.comparison_operator, rule.quantity_threshold))
            continue;
        if (!this.payFlux(player, card.definition.flux_cost ?? 0) || !this.move(player, card, player.hand, player.discard, "hand", "discard"))
            continue;
        this.note(`${player.id} | reaction_play:${card.definition.card_id}:${event.amount}`);
        this.act(player, `resolve reaction ${card.definition.card_id}`);
        if (card.definition.mechanics?.some(mechanic => mechanic.type === "prevent_triggering_event")) {
            event.prevented = true;
            this.note(`${event.recipient.id} | flux_gain_prevented:${event.amount}:${card.definition.card_id}`);
        }
        return true;
    } return false; }
    react(event) { let priority = this.players[this.active], passes = 0; while (this.winner === undefined && !event.prevented && passes < 2) {
        if (this.playReaction(priority, event))
            passes = 0;
        else
            passes++;
        priority = this.opponent(priority);
    } }
    gain(p, amount, bonus = true, source) { const gain = Math.max(0, amount); if (!gain)
        return; const event = { type: "opponent_would_gain_flux", recipient: p, amount: gain, source }; this.note(`${p.id} | pending_flux_gain:${gain}:${source ?? ""}`); const preventers = this.preventersFor(event); if (preventers.length) {
        event.prevented = true;
        this.note(`${p.id} | flux_gain_prevented:${gain}:${preventers[0].definition.card_id}`);
        for (const preventer of preventers)
            this.move(this.opponent(p), preventer, this.opponent(p).battlefield, this.opponent(p).discard, "battlefield", "discard");
    }
    else
        this.react(event); if (event.prevented)
        return; const before = p.points; this.changePoints(p, gain, source); const applied = p.points - before; if (applied && bonus)
        for (const daemon of p.battlefield)
            for (const mechanic of daemon.definition.mechanics ?? [])
                if (mechanic.type === "victory_point_gain_bonus")
                    this.gain(p, mechanic.amount, false, `bonus:${daemon.definition.card_id}`); }
    scanDeck(p, count, cardIds) { const lookedAt = p.deck.slice(0, Math.max(0, count)), matches = new Set(cardIds); let found = 0; for (const card of lookedAt) {
        if (this.winner !== undefined)
            return;
        if (matches.has(card.definition.card_id) && this.move(p, card, p.deck, p.hand, "deck", "hand"))
            found++;
    } for (const card of lookedAt) {
        if (this.winner !== undefined)
            return;
        if (!matches.has(card.definition.card_id))
            this.move(p, card, p.deck, p.deck, "deck", "deck");
    } this.note(`${p.id} | scan_deck:${lookedAt.length}:${found}`); }
    resolve(p, card) { for (const m of card.definition.mechanics ?? []) {
        if (this.winner !== undefined)
            return;
        if (m.type === "gain_flux")
            this.gain(p, m.amount);
        else if (m.type === "remove_opponent_victory_points")
            this.changePoints(this.opponent(p), -m.amount);
        else if (m.type === "gain_victory_points_if_at_most") {
            if (p.points <= m.threshold)
                this.gain(p, m.amount);
            else
                this.note(`${p.id} | conditional_flux_effect_failed`);
        }
        else if (m.type === "remove_opponent_sync")
            this.changeSync(this.opponent(p), -m.amount);
        else if (m.type === "scan_deck")
            this.scanDeck(p, m.count, m.card_ids);
        else if (m.type === "set_own_sync_and_draw_half_deck") {
            this.setSync(p, m.sync);
            const drawCount = Math.floor(p.deck.length / 2);
            let drawn = 0;
            for (let i = 0; i < drawCount && this.winner === undefined; i++)
                drawn += Number(this.draw(p, false));
            if (drawn)
                this.note(`${p.id} | draw_many:${drawn}`);
        }
        else if (m.type === "end_own_turn") {
            this.phase = "end";
            this.note(`${p.id} | end_turn_effect`);
        }
        else if (m.type === "queue_extra_turn") {
            this.extraTurns[this.players.indexOf(p)]++;
            this.note(`${p.id} | extra_turn_queued`);
        }
    } }
    play(p, card) { if (!this.canPlay(p, card) || !this.payFlux(p, card.definition.flux_cost ?? 0) || !this.move(p, card, p.hand, p.battlefield, "hand", "battlefield"))
        return false; this.note(`${p.id} | play:${card.definition.card_id}`); this.act(p, `resolve ${card.definition.card_id}`); this.resolve(p, card); if (card.definition.card_kind === "pulse")
        this.move(p, card, p.battlefield, p.discard, "battlefield", "discard"); if (p.points >= this.config.victory_points_to_win)
        this.finish(p.id, "flux"); return this.winner === undefined; }
    randomCandidates(p, restricted = false) { return (restricted ? p.hand.filter(card => !p.random_card_ids || p.random_card_ids.includes(card.definition.card_id)) : p.hand).filter(card => card.definition.card_kind !== "glitch"); }
    canAct(p, r) { if (r.action_type === "end_turn")
        return true; if (r.action_type === "play_random_card")
        return this.randomCandidates(p, r.default_random).some(card => this.canPlay(p, card)); return p.hand.some(card => card.definition.card_id === r.action_card_id && this.canPlay(p, card)); }
    action(p, r) { if (!this.canAct(p, r))
        return false; if (r.action_type === "end_turn") {
        this.phase = "end";
        this.note(`${p.id} | end_turn_action`);
        return false;
    } if (r.action_type === "play_random_card") {
        const choices = this.randomCandidates(p, r.default_random).filter(card => this.canPlay(p, card)), card = choices[this.rng.int(choices.length)];
        return !!card && this.play(p, card);
    } const card = p.hand.find(instance => instance.definition.card_id === r.action_card_id && this.canPlay(p, instance)); return !!card && this.play(p, card); }
    matching(p, r) { const opponent = this.opponent(p), quantity = r.quantity === "cards_in_your_deck" ? p.deck.length : r.quantity === "cards_in_your_hand" ? p.hand.length : r.quantity === "cards_in_opponent_hand" ? opponent.hand.length : r.quantity === "your_flux" ? p.points : r.quantity === "opponent_flux" ? opponent.points : r.quantity === "your_sync" ? p.sync : r.quantity === "opponent_sync" ? opponent.sync : 0, condition = r.condition_type === "if_able" ? true : r.condition_type === "card_in_hand" ? p.hand.some(c => c.definition.card_id === r.condition_card_id) : r.condition_type === "card_is" ? (r.card_condition === "in_your_hand" ? p.hand : p.battlefield).some(c => c.definition.card_id === r.condition_card_id) : r.condition_type === "quantity_compare" ? compare(quantity, r.comparison_operator ?? "<", r.quantity_threshold ?? 0) : r.condition_type === "own_victory_points_at_most" ? p.points <= (r.victory_points_threshold ?? 0) : r.condition_type === "opponent_victory_points_at_most" ? opponent.points <= (r.victory_points_threshold ?? 0) : r.condition_type === "opponent_sync_at_most" ? opponent.sync <= (r.victory_points_threshold ?? 0) : opponent.points >= (r.victory_points_threshold ?? 0); return condition && this.canAct(p, r); }
    takeTurn() { this.turnCount++; const p = this.players[this.active]; for (const phase of ["start", "draw", "main", "end"]) {
        if (this.winner !== undefined)
            return;
        this.phase = phase;
        this.act(p, `${p.id} enters ${phase} phase`);
        if (phase === "start")
            this.note(`${p.id} | turn_start`);
        else if (phase === "draw")
            this.draw(p);
        else if (phase === "main")
            while (this.winner === undefined && p.hand.length) {
                const r = p.program.find(rule => this.matching(p, rule));
                if (!this.action(p, r ?? { condition_type: "if_able", action_type: p.default_action, default_random: true }))
                    break;
            }
        else
            this.note(`${p.id} | turn_end`);
    } const index = this.players.indexOf(p); if (this.extraTurns[index]) {
        this.extraTurns[index]--;
        this.note(`${p.id} | extra_turn_taken`);
    }
    else
        this.active = (1 - this.active); }
    finish(winner, reason) { if (this.winner !== undefined)
        return; this.winner = winner; this.reason = reason; this.note(`system | battle_end:${winner ?? "draw"}:${reason}`); }
    run() { while (this.winner === undefined)
        this.takeTurn(); return this.record(1, 0); }
    record(game_number, seed) { const [a, b] = this.players; return { game_number, seed, starting_player: this.starting_player, turn_count: this.turnCount, winner_id: this.winner ?? null, end_reason: this.reason, first_victory_points: a.points, second_victory_points: b.points, log: this.log }; }
}
export function replayBattle(first, second, cards, seed, config = DEFAULT_CONFIG, startingPlayer = 0) { const battle = new Battle(first, second, cards, config, new Rng(seed)); battle.active = startingPlayer; battle.starting_player = startingPlayer; return battle.run(); }
export function simulateMatch(first, second, cards, games, seed = 1, config = DEFAULT_CONFIG) { const master = new Rng(seed); const battles = []; let wins = 0, losses = 0; for (let i = 0; i < games; i++) {
    const battleSeed = (master.next() * 0x100000000) >>> 0, battle = new Battle(first, second, cards, config, new Rng(battleSeed), false);
    battle.active = i % 2;
    battle.starting_player = battle.active;
    const { log: _log, ...record } = battle.run();
    battles.push({ ...record, game_number: i + 1, seed: battleSeed });
    if (record.winner_id === "first")
        wins++;
    else if (record.winner_id === "second")
        losses++;
} return { battles, wins, losses, draws: games - wins - losses }; }
