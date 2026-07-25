export const FORMAT_VERSION = "cd-ts-1";
export const DEFAULT_CONFIG = { minimum_deck_size: 20, maximum_deck_size: 30, starting_hand_size: 5, victory_points_to_win: 20, simulations_per_match: 1000, maximum_actions_per_battle: 100000 };
/** Small deterministic PRNG used exclusively by the engine and replay. */
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
export function validateSubmission(s, cards, config = DEFAULT_CONFIG) { const size = Object.values(s.decklist).reduce((a, b) => a + b, 0); if (size < config.minimum_deck_size || size > config.maximum_deck_size)
    throw Error(`${s.name}: deck has ${size} cards; allowed size is ${config.minimum_deck_size}-${config.maximum_deck_size}.`); for (const [id, count] of Object.entries(s.decklist))
    if (!cards[id] || count <= 0)
        throw Error(`Invalid card quantity for ${id}.`); }
export class Battle {
    first;
    second;
    cards;
    config;
    rng;
    captureLog;
    log = [];
    actionCount = 0;
    winner;
    reason = "";
    active = 0;
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
    player(s, id) { const deck = []; for (const [card_id, count] of Object.entries(s.decklist))
        for (let i = 0; i < count; i++)
            deck.push({ uid: `${id}:${card_id}:${i}`, definition: this.cards[card_id] }); return { id, program: s.program, deck, hand: [], discard: [], battlefield: [], points: 0, actions: 0 }; }
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
    draw(p, narrate = true) { const c = p.deck[0]; if (!c)
        return false; const moved = this.move(p, c, p.deck, p.hand, "deck", "hand"); if (moved && narrate)
        this.note(`${p.id} | draw`); return moved; }
    changePoints(p, amount) { this.act(p, `change victory points by ${amount}`); p.points = Math.max(0, p.points + amount); this.note(`${p.id} | victory_points:${amount}:${p.points}:${Math.max(0, this.config.victory_points_to_win - p.points)}`); }
    gain(p, amount, bonus = true) { const before = p.points; this.changePoints(p, Math.max(0, amount)); const applied = p.points - before; if (applied && bonus) {
        const extra = p.battlefield.flatMap(c => c.definition.mechanics ?? []).filter((m) => (m.type === "victory_point_gain_bonus")).reduce((n, m) => n + m.amount, 0);
        if (extra)
            this.gain(p, extra, false);
    } }
    resolve(p, card) { for (const m of card.definition.mechanics ?? []) {
        if (m.type === "remove_opponent_victory_points")
            this.changePoints(this.opponent(p), -m.amount);
        else if (m.type === "gain_victory_points_if_at_most") {
            if (p.points <= m.threshold)
                this.gain(p, m.amount);
            else
                this.note(`${p.id} | conditional_victory_point_effect_failed`);
        }
    } this.gain(p, card.definition.victory_points); }
    play(p, card) { if (this.phase !== "main" || !this.move(p, card, p.hand, p.battlefield, "hand", "battlefield"))
        return false; this.note(`${p.id} | play:${card.definition.card_id}`); this.act(p, `resolve ${card.definition.card_id}`); this.resolve(p, card); if (card.definition.card_kind === "pulse")
        this.move(p, card, p.battlefield, p.discard, "battlefield", "discard"); if (p.points >= this.config.victory_points_to_win)
        this.finish(p.id, "victory_points"); return this.winner === undefined; }
    canAct(p, r) { if (r.action_type === "end_turn")
        return true; if (r.action_type === "play_random_card")
        return p.hand.length > 0; return p.hand.some(card => card.definition.card_id === r.action_card_id); }
    action(p, r) { if (!this.canAct(p, r))
        return false; if (r.action_type === "end_turn") {
        this.phase = "end";
        this.note(`${p.id} | end_turn_action`);
        return false;
    } if (r.action_type === "play_random_card") {
        const c = p.hand[this.rng.int(p.hand.length)];
        return !!c && this.play(p, c);
    } const c = p.hand.find(x => x.definition.card_id === r.action_card_id); return !!c && this.play(p, c); }
    matching(p, r) { if (r.condition_type === "if_able")
        return this.canAct(p, r); if (r.condition_type === "card_in_hand")
        return p.hand.some(c => c.definition.card_id === r.condition_card_id); if (r.condition_type === "own_victory_points_at_most")
        return p.points <= (r.victory_points_threshold ?? 0); return this.opponent(p).points <= (r.victory_points_threshold ?? 0); }
    takeTurn() { const p = this.players[this.active]; for (const phase of ["start", "draw", "main", "end"]) {
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
                if (!this.action(p, r ?? { condition_type: "if_able", action_type: "play_random_card" }))
                    break;
            }
        else
            this.note(`${p.id} | turn_end`);
    } this.active = 1 - this.active; }
    finish(winner, reason) { if (this.winner !== undefined)
        return; this.winner = winner; this.reason = reason; this.note(`system | battle_end:${winner ?? "draw"}:${reason}`); }
    run() { while (this.winner === undefined) {
        if (!this.players.some(p => p.deck.length || p.hand.length)) {
            const [a, b] = this.players;
            this.finish(a.points === b.points ? null : a.points > b.points ? a.id : b.id, "cards_exhausted");
            break;
        }
        this.takeTurn();
    } return this.record(1, 0); }
    record(game_number, seed) { const [a, b] = this.players; return { game_number, seed, winner_id: this.winner ?? null, end_reason: this.reason, first_victory_points: a.points, second_victory_points: b.points, log: this.log }; }
}
export function replayBattle(first, second, cards, seed, config = DEFAULT_CONFIG) { return new Battle(first, second, cards, config, new Rng(seed)).run(); }
export function simulateMatch(first, second, cards, games, seed = 1, config = DEFAULT_CONFIG) { const master = new Rng(seed); const battles = []; let wins = 0, losses = 0; for (let i = 0; i < games; i++) {
    const battleSeed = (master.next() * 0x100000000) >>> 0;
    const b = new Battle(first, second, cards, config, new Rng(battleSeed), false);
    b.active = i % 2;
    const { log: _log, ...record } = b.run();
    battles.push({ ...record, game_number: i + 1, seed: battleSeed });
    if (record.winner_id === "first")
        wins++;
    else if (record.winner_id === "second")
        losses++;
} return { battles, wins, losses, draws: games - wins - losses }; }
