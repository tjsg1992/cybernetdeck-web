/** DOM-free CyberNet Deck rules core. Keep cards declarative and mutations here. */
function namedAgentName(definition) {
    if (definition.card_kind !== "agent") {
        return undefined;
    }
    const match = definition.display_name.match(/^([^,]+),\s*(.+)$/);
    return match?.[1].trim() || undefined;
}
export const FORMAT_VERSION = "cd-ts-1";
export const DEFAULT_CONFIG = {
    minimum_deck_size: 20,
    maximum_deck_size: 30,
    starting_hand_size: 5,
    victory_points_to_win: 20,
    simulations_per_match: 1000,
    maximum_actions_per_battle: 100000,
};
/** Seeded pseudo-random source used by all battle and simulation operations. */
export class Rng {
    state;
    constructor(state) {
        this.state = state;
    }
    next() {
        this.state = (this.state + 0x6d2b79f5) >>> 0;
        let t = this.state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    int(max) {
        return Math.floor(this.next() * max);
    }
    shuffle(items) {
        for (let i = items.length - 1; i > 0; i--) {
            const j = this.int(i + 1);
            [items[i], items[j]] = [items[j], items[i]];
        }
        return items;
    }
}
const OPERATORS = ["<", "<=", "=", ">=", ">"];
const QUANTITY_KINDS = [
    "cards_in_deck",
    "cards_in_hand",
    "cards_on_board",
    "flux",
    "ki",
    "bandwidth",
    "sync",
];
const LEGACY_QUANTITIES = [
    "cards_in_your_deck",
    "cards_in_your_hand",
    "cards_in_opponent_deck",
    "cards_in_opponent_hand",
    "cards_on_your_board",
    "cards_on_opponent_board",
    "your_flux",
    "opponent_flux",
    "your_ki",
    "opponent_ki",
    "your_bandwidth",
    "opponent_bandwidth",
    "your_sync",
    "opponent_sync",
];
const STRUCTURED_QUANTITY_MAP = {
    your: {
        cards_in_deck: "cards_in_your_deck",
        cards_in_hand: "cards_in_your_hand",
        cards_on_board: "cards_on_your_board",
        flux: "your_flux",
        ki: "your_ki",
        bandwidth: "your_bandwidth",
        sync: "your_sync",
    },
    opponent: {
        cards_in_deck: "cards_in_opponent_deck",
        cards_in_hand: "cards_in_opponent_hand",
        cards_on_board: "cards_on_opponent_board",
        flux: "opponent_flux",
        ki: "opponent_ki",
        bandwidth: "opponent_bandwidth",
        sync: "opponent_sync",
    },
};
function normalizedQuantity(rule) {
    if (rule.quantity_target !== undefined) {
        if (!["your", "opponent"].includes(rule.quantity_target) ||
            !QUANTITY_KINDS.includes(rule.quantity)) {
            return undefined;
        }
        return STRUCTURED_QUANTITY_MAP[rule.quantity_target][rule.quantity];
    }
    return LEGACY_QUANTITIES.includes(rule.quantity)
        ? rule.quantity
        : undefined;
}
const CARD_KIND_SIGN = {
    agent: "ram",
    daemon: "ox",
    pulse: "tiger",
    glitch: "snake",
};
const SIGN_LABELS = {
    ram: "Ram",
    ox: "Ox",
    tiger: "Tiger",
    snake: "Snake",
};
const compare = (value, operator, threshold) => operator === "<"
    ? value < threshold
    : operator === "<="
        ? value <= threshold
        : operator === "="
            ? value === threshold
            : operator === ">="
                ? value >= threshold
                : value > threshold;
export function validateSubmission(submission, cards, config = DEFAULT_CONFIG) {
    const size = Object.values(submission.decklist).reduce((total, count) => total + count, 0);
    if (size < config.minimum_deck_size ||
        size > config.maximum_deck_size) {
        throw Error(`${submission.name}: deck has ${size} cards; allowed size is ${config.minimum_deck_size}-${config.maximum_deck_size}.`);
    }
    for (const [id, count] of Object.entries(submission.decklist)) {
        if (!cards[id] || !Number.isSafeInteger(count) || count <= 0) {
            throw Error(`Invalid card quantity for ${id}.`);
        }
        if (cards[id].signature) {
            throw Error(`Signature card ${id} cannot be included in a deck.`);
        }
        if (cards[id].jutsu && (!cards[id].signs?.length || cards[id].signs.some((sign) => !SIGN_LABELS[sign]))) {
            throw Error(`Jutsu ${id} must have at least one valid Sign.`);
        }
        if (cards[id].immutable && count > 1) {
            throw Error(`Immutable card quantity for ${id} cannot exceed one.`);
        }
    }
    if (submission.program.length > 10) {
        throw Error("A program may contain at most 10 rules.");
    }
    const reactions = submission.reactions ?? [];
    if (!Array.isArray(reactions) || reactions.length > 10) {
        throw Error("A reaction program may contain at most 10 rules.");
    }
    if (submission.default_action !== undefined &&
        submission.default_action !== "play_random_card" &&
        submission.default_action !== "end_turn") {
        throw Error("Invalid default action.");
    }
    if (submission.random_card_ids?.some((id) => !submission.decklist[id])) {
        throw Error("A random-card choice must be in the deck.");
    }
    for (const rule of submission.program) {
        if (![
            "if_able",
            "card_in_hand",
            "card_is",
            "quantity_compare",
            "own_victory_points_at_most",
            "opponent_victory_points_at_most",
            "opponent_sync_at_most",
            "opponent_victory_points_at_least",
        ].includes(rule.condition_type)) {
            throw Error("Invalid rule condition.");
        }
        if (!["play_named_card", "play_combo", "activate_immutable_card", "play_random_card", "end_turn"].includes(rule.action_type)) {
            throw Error("Invalid rule action.");
        }
        if ((rule.condition_type === "card_in_hand" ||
            rule.condition_type === "card_is") &&
            (!rule.condition_card_id || !cards[rule.condition_card_id])) {
            throw Error("Invalid card condition card.");
        }
        if (rule.condition_type === "card_is" &&
            rule.card_condition !== "in_your_hand" &&
            rule.card_condition !== "on_your_side_of_board" &&
            rule.card_condition !== "on_opponent_side_of_board") {
            throw Error("Invalid card condition.");
        }
        if (rule.condition_type === "quantity_compare" &&
            (!normalizedQuantity(rule) ||
                !OPERATORS.includes(rule.comparison_operator ?? "<") ||
                !Number.isSafeInteger(rule.quantity_threshold) ||
                rule.quantity_threshold < 0)) {
            throw Error("Invalid quantity condition.");
        }
        if ((rule.action_type === "play_named_card" || rule.action_type === "activate_immutable_card") &&
            (!rule.action_card_id || !cards[rule.action_card_id] ||
                (rule.action_type === "play_named_card" && cards[rule.action_card_id].immutable) ||
                (rule.action_type === "activate_immutable_card" && !cards[rule.action_card_id].immutable))) {
            throw Error("Invalid named play card.");
        }
        if (rule.action_type === "play_combo" &&
            (!Array.isArray(rule.action_card_ids) ||
                rule.action_card_ids.length === 0 ||
                rule.action_card_ids.some((cardId) => !cardId || !cards[cardId] || cards[cardId].immutable))) {
            throw Error("Invalid combo play cards.");
        }
        if (rule.action_card_all_ids !== undefined &&
            (!Array.isArray(rule.action_card_all_ids) ||
                rule.action_card_all_ids.some((cardId) => !rule.action_card_ids?.includes(cardId)))) {
            throw Error("Invalid Combo all-card choices.");
        }
        if (rule.cancel_if_card_not_played !== undefined &&
            typeof rule.cancel_if_card_not_played !== "boolean") {
            throw Error("Invalid combo cancellation setting.");
        }
    }
    for (const rule of reactions) {
        if (rule.trigger_type !== "opponent_would_gain_flux" ||
            !OPERATORS.includes(rule.comparison_operator) ||
            !Number.isSafeInteger(rule.quantity_threshold) ||
            rule.quantity_threshold < 0 ||
            !cards[rule.action_card_id] ||
            cards[rule.action_card_id].card_kind !== "glitch") {
            throw Error("Invalid reaction rule.");
        }
    }
}
/** Owns all mutable battle state and state-transition operations. */
export class Battle {
    first;
    second;
    cards;
    config;
    rng;
    captureLog;
    scenarioSetup;
    log = [];
    turnSnapshots = [];
    deckSnapshots = [];
    drawEvents = [];
    actionCount = 0;
    turnCount = 0;
    extraTurns = [[], []];
    generatedCardCount = 0;
    canceledComboRule;
    winner;
    reason = "";
    active = 0;
    starting_player = 0;
    phase = "start";
    players;
    constructor(first, second, cards, config, rng, captureLog = true, scenarioSetup) {
        this.first = first;
        this.second = second;
        this.cards = cards;
        this.config = config;
        this.rng = rng;
        this.captureLog = captureLog;
        this.scenarioSetup = scenarioSetup;
        if (!scenarioSetup) {
            validateSubmission(first, cards, config);
            validateSubmission(second, cards, config);
        }
        this.players = [this.player(first, "first"), this.player(second, "second")];
        if (scenarioSetup) {
            this.applyScenarioSetup(scenarioSetup);
        }
        else {
            for (const player of this.players) {
                this.randomize(player, player.deck);
                let drawn = 0;
                for (const immutable of player.deck.filter((card) => card.definition.immutable)) {
                    this.move(player, immutable, player.deck, player.hand, "deck", "hand");
                }
                for (let i = player.hand.length; i < config.starting_hand_size; i++) {
                    drawn += Number(this.draw(player, false));
                }
                if (drawn || player.hand.some((card) => card.definition.immutable)) {
                    this.note(`${player.id} | opening_hand`);
                }
            }
        }
    }
    applyScenarioSetup(setup) {
        for (const player of this.players) {
            const playerSetup = setup.players[player.id];
            const makeCards = (area, areaName) => (area ?? []).map((cardId, index) => {
                const definition = this.cards[cardId];
                if (!definition) {
                    throw Error(`Scenario setup references unknown card ${cardId}.`);
                }
                return {
                    uid: `scenario:${player.id}:${areaName}:${index}:${cardId}`,
                    definition,
                    ...(definition.card_kind === "agent"
                        ? { remaining_integrity: definition.integrity }
                        : {}),
                    ...(definition.jutsu ? { formed_signs: 0 } : {}),
                };
            });
            player.deck = makeCards(playerSetup.deck, "deck");
            player.hand = makeCards(playerSetup.hand, "hand");
            player.battlefield = makeCards(playerSetup.battlefield, "battlefield");
            player.preparedJutsu = makeCards(playerSetup.prepared_jutsu ? [playerSetup.prepared_jutsu] : [], "prepared");
            player.discard = makeCards(playerSetup.discard, "discard");
            player.void = makeCards(playerSetup.void, "void");
            player.points = playerSetup.flux ?? 0;
            player.sync = playerSetup.sync ?? 20;
            player.ki = playerSetup.ki ?? 0;
            player.uplink = playerSetup.uplink ?? 0;
            player.maxBandwidth = Math.max(0, playerSetup.bandwidth_max ?? playerSetup.bandwidth ?? 0);
            player.bandwidth = Math.min(player.maxBandwidth, Math.max(0, playerSetup.bandwidth ?? player.maxBandwidth));
            player.cardsPlayedThisTurn = playerSetup.cards_played_this_turn ?? 0;
        }
        this.active = setup.active_player ?? 0;
        this.turnCount = setup.turn ?? 1;
        this.phase = setup.phase ?? "main";
    }
    player(submission, id) {
        const deck = [];
        for (const [card_id, count] of Object.entries(submission.decklist).sort(([a], [b]) => a.localeCompare(b))) {
            for (let i = 0; i < count; i++) {
                const definition = this.cards[card_id];
                deck.push({
                    uid: `${id}:${card_id}:${i}`,
                    definition,
                    ...(definition.card_kind === "agent"
                        ? { remaining_integrity: definition.integrity }
                        : {}),
                    ...(definition.jutsu ? { formed_signs: 0 } : {}),
                });
            }
        }
        return {
            id,
            program: submission.program,
            reactions: submission.reactions ?? [],
            deck,
            hand: [],
            discard: [],
            void: [],
            battlefield: [],
            preparedJutsu: [],
            points: 0,
            sync: 20,
            ki: 0,
            uplink: 0,
            bandwidth: 0,
            maxBandwidth: 0,
            cardsPlayedThisTurn: 0,
            actions: 0,
            default_action: submission.default_action ?? "play_random_card",
            random_card_ids: submission.random_card_ids,
        };
    }
    opponent(player) {
        return this.players[0] === player ? this.players[1] : this.players[0];
    }
    note(text) {
        if (this.captureLog) {
            this.log.push(text);
        }
    }
    mechanicTriggeredThisTurn(card, mechanicType) {
        return card.triggeredMechanics?.[mechanicType] === this.turnCount;
    }
    markMechanicTriggeredThisTurn(card, mechanicType) {
        (card.triggeredMechanics ??= {})[mechanicType] = this.turnCount;
    }
    snapshotDeck(player, eventIndex = this.log.length - 1) {
        if (!this.captureLog || !this.log.length || eventIndex < 0) {
            return;
        }
        this.deckSnapshots.push({
            eventIndex,
            player: player.id,
            deck: player.deck.map((card) => card.definition.card_id),
        });
    }
    act(player, text) {
        if (this.winner !== undefined) {
            return false;
        }
        this.actionCount++;
        player.actions++;
        this.note(text);
        if (this.actionCount > this.config.maximum_actions_per_battle) {
            const [first, second] = this.players;
            this.finish(first.actions === second.actions
                ? null
                : first.actions < second.actions
                    ? first.id
                    : second.id, first.actions === second.actions ? "action_limit_tie" : "action_limit");
            return false;
        }
        return true;
    }
    move(player, card, from, to, fromName, toName) {
        if (from === player.battlefield && card.definition.immutable) {
            this.note(`${player.id} | immutable_move_prevented:${card.definition.card_id}`);
            return false;
        }
        if (!from.includes(card) ||
            !this.act(player, `move ${card.uid} from ${fromName} to ${toName}`)) {
            return false;
        }
        from.splice(from.indexOf(card), 1);
        to.push(card);
        return true;
    }
    randomize(player, area) {
        this.act(player, "randomize deck");
        this.rng.shuffle(area);
    }
    shuffleDeck(player) {
        if (!this.act(player, `${player.id} | shuffle deck`)) {
            return false;
        }
        this.rng.shuffle(player.deck);
        this.snapshotDeck(player);
        return true;
    }
    snapshotDraw(player, cards, eventIndex = this.log.length - 1) {
        if (!this.captureLog || !cards.length || eventIndex < 0) {
            return;
        }
        this.drawEvents.push({
            eventIndex,
            player: player.id,
            cards: [...cards],
        });
    }
    draw(player, narrate = true, drawnCards) {
        const card = player.deck[0];
        if (!card) {
            this.note(`${player.id} | draw_failed`);
            this.snapshotDeck(player);
            this.finish(this.opponent(player).id, "deck_exhausted");
            return false;
        }
        const moved = this.move(player, card, player.deck, player.hand, "deck", "hand");
        if (moved) {
            drawnCards?.push(card.definition.card_id);
            if (narrate) {
                this.note(`${player.id} | draw`);
                this.snapshotDraw(player, [card.definition.card_id]);
            }
        }
        return moved;
    }
    changePoints(player, amount, source) {
        this.act(player, `change flux by ${amount}`);
        const before = player.points;
        player.points = Math.max(0, player.points + amount);
        const applied = player.points - before;
        if (applied) {
            this.note(`${player.id} | flux:${applied}:${player.points}:${source ?? ""}`);
        }
    }
    canPayFlux(player, amount) {
        return player.points >= Math.max(0, amount);
    }
    canPayBandwidth(player, amount) {
        return player.bandwidth >= Math.max(0, amount);
    }
    canPaySync(player, amount) {
        return player.sync >= Math.max(0, amount);
    }
    canPayCosts(player, card) {
        return (this.canPayFlux(player, card.flux_cost ?? 0) &&
            this.canPayBandwidth(player, card.bandwidth_cost ?? 0) &&
            this.canPaySync(player, card.sync_cost ?? 0));
    }
    payCosts(player, card) {
        const fluxCost = Math.max(0, card.flux_cost ?? 0);
        const bandwidthCost = Math.max(0, card.bandwidth_cost ?? 0);
        const syncCost = Math.max(0, card.sync_cost ?? 0);
        if (!this.canPayFlux(player, fluxCost) ||
            !this.canPayBandwidth(player, bandwidthCost) ||
            !this.canPaySync(player, syncCost)) {
            return false;
        }
        if (fluxCost) {
            this.changePoints(player, -fluxCost, "cost");
            this.note(`${player.id} | flux_paid:${fluxCost}`);
        }
        if (bandwidthCost) {
            this.act(player, `spend ${bandwidthCost} bandwidth`);
            player.bandwidth -= bandwidthCost;
            this.note(`${player.id} | bandwidth_paid:${bandwidthCost}:${player.bandwidth}:${player.maxBandwidth}`);
        }
        if (syncCost) {
            this.changeSync(player, -syncCost);
            this.note(`${player.id} | sync_paid:${syncCost}:${player.sync}`);
            if (this.winner !== undefined) {
                return false;
            }
        }
        return true;
    }
    canPlayRestrictions(player, card) {
        const name = namedAgentName(card.definition);
        const duplicateNamedAgent = name !== undefined &&
            player.battlefield.some((installed) => namedAgentName(installed.definition) === name);
        return (card.definition.card_kind !== "glitch" &&
            (this.phase === "main" || this.phase === "pregame") &&
            !duplicateNamedAgent &&
            player.uplink >= (card.definition.uplink_requirement ?? 0) &&
            player.ki >= (card.definition.minimum_ki ?? 0) &&
            (!card.definition.requires_no_prior_play || player.cardsPlayedThisTurn === 0) &&
            (!card.definition.jutsu ||
                (player.preparedJutsu.length === 0 &&
                    player.battlefield.some((installed) => installed.definition.supports_jutsu_preparation))));
    }
    canPlay(player, card) {
        return this.canPlayRestrictions(player, card) && this.canPayCosts(player, card.definition);
    }
    canActivate(player, card) {
        return (card.definition.immutable === true &&
            card.definition.activation !== "passive" &&
            this.phase === "main" &&
            this.canPayCosts(player, card.definition) &&
            player.uplink >= (card.definition.uplink_requirement ?? 0) &&
            player.ki >= (card.definition.minimum_ki ?? 0) &&
            (!card.definition.requires_no_prior_play || player.cardsPlayedThisTurn === 0));
    }
    resolveSyncZeroTriggers(player) {
        const triggers = player.battlefield.filter((card) => card.definition.mechanics?.some((mechanic) => mechanic.type === "restore_sync_when_zero_and_delete_self"));
        for (const daemon of triggers) {
            const mechanic = daemon.definition.mechanics?.find((candidate) => candidate.type === "restore_sync_when_zero_and_delete_self");
            if (!mechanic || !this.act(player, `resolve ${daemon.definition.card_id}`)) {
                return;
            }
            this.setSync(player, mechanic.sync, daemon.definition.card_id);
            if (this.move(player, daemon, player.battlefield, player.discard, "battlefield", "discard")) {
                this.note(`${player.id} | triggered_card_deleted:${daemon.definition.card_id}`);
            }
        }
    }
    resolveSyncLossBonuses(sourcePlayer, target, causingCard) {
        const bonuses = [];
        for (const daemon of sourcePlayer.battlefield) {
            for (const mechanic of daemon.definition.mechanics ?? []) {
                if (mechanic.type === "opponent_sync_loss_bonus") {
                    bonuses.push({ daemon, amount: Math.max(0, mechanic.amount) });
                }
            }
        }
        for (const { daemon, amount } of bonuses) {
            if (!amount || target.sync <= 0 || this.winner !== undefined) {
                continue;
            }
            if (!this.act(sourcePlayer, `resolve ${daemon.definition.card_id}`)) {
                return;
            }
            this.note(`${sourcePlayer.id} | sync_loss_bonus:${causingCard.definition.card_id}:${daemon.definition.card_id}:${amount}`);
            // This is the additional loss for the same event, so it must not
            // recursively trigger the Dragon Install bonuses again.
            this.changeSync(target, -amount, undefined, `bonus:${daemon.definition.card_id}`);
        }
    }
    setSync(player, value, source, causingCard, changeSource) {
        if (!this.act(player, `set sync to ${value}`)) {
            return;
        }
        const before = player.sync;
        player.sync = Math.max(0, value);
        const applied = player.sync - before;
        const actualLoss = Math.max(0, before - player.sync);
        if (source) {
            this.note(`${player.id} | sync_set:${value}:${player.sync}:${source}`);
        }
        else if (applied) {
            const event = changeSource
                ? `${player.id} | sync:${applied}:${player.sync}:${changeSource}`
                : `${player.id} | sync:${applied}:${player.sync}`;
            this.note(event);
        }
        if (before > 0 && player.sync === 0) {
            this.resolveSyncZeroTriggers(player);
        }
        if (actualLoss && causingCard && this.winner === undefined) {
            this.resolveSyncLossBonuses(this.opponent(player), player, causingCard);
        }
        if (player.sync === 0) {
            this.finish(this.opponent(player).id, "sync");
        }
    }
    changeSync(player, amount, causingCard, changeSource) {
        this.setSync(player, player.sync + amount, undefined, causingCard, changeSource);
    }
    gainKi(player, amount) {
        const gain = Math.max(0, amount);
        if (!gain || !this.act(player, `gain ${gain} ki`)) {
            return;
        }
        player.ki += gain;
        this.note(`${player.id} | ki:${gain}:${player.ki}`);
    }
    gainUplink(player, amount) {
        const gain = Math.max(0, amount);
        if (!gain || !this.act(player, `gain ${gain} uplink`)) {
            return;
        }
        player.uplink += gain;
        this.note(`${player.id} | uplink:${gain}:${player.uplink}`);
    }
    increaseBandwidthMaxAndRestore(player, amount) {
        const gain = Math.max(0, amount);
        if (!gain || !this.act(player, `increase bandwidth maximum by ${gain}`)) {
            return;
        }
        player.maxBandwidth += gain;
        player.bandwidth = player.maxBandwidth;
        this.note(`${player.id} | bandwidth:${gain}:${player.bandwidth}:${player.maxBandwidth}`);
    }
    deleteDaemon(player, card, event = "daemon_deleted") {
        if (card.definition.immutable) {
            return false;
        }
        if (this.move(player, card, player.battlefield, player.discard, "battlefield", "discard")) {
            this.note(`${player.id} | ${event}:${card.definition.card_id}`);
            return true;
        }
        return false;
    }
    wipe(player, card) {
        if (this.move(player, card, player.battlefield, player.void, "battlefield", "void")) {
            this.note(`${player.id} | wiped:${card.definition.card_id}`);
            return true;
        }
        return false;
    }
    addCardsToDeck(player, cardId, amount, shuffle, source) {
        const definition = this.cards[cardId];
        if (!definition) {
            return;
        }
        if (definition.signature) {
            this.note(`${player.id} | add_to_deck_rejected_signature:${cardId}:${source}`);
            return;
        }
        let added = 0;
        for (let index = 0; index < Math.max(0, amount); index++) {
            if (!this.act(player, `create ${cardId} in deck`)) {
                break;
            }
            this.generatedCardCount++;
            player.deck.push({
                uid: `generated:${player.id}:${this.generatedCardCount}:${cardId}`,
                definition,
                ...(definition.card_kind === "agent"
                    ? { remaining_integrity: definition.integrity }
                    : {}),
            });
            added++;
        }
        if (added) {
            this.note(`${player.id} | cards_added_to_deck:${added}:${cardId}:${source}:${shuffle ? "shuffled" : "ordered"}`);
            const addedEventIndex = this.log.length - 1;
            if (shuffle) {
                this.shuffleDeck(player);
            }
            this.snapshotDeck(player, addedEventIndex);
        }
    }
    addSignatureToHand(player, cardId, source) {
        const definition = this.cards[cardId];
        if (!definition?.signature || !this.act(player, `create ${cardId} in hand`)) {
            return;
        }
        this.generatedCardCount++;
        player.hand.push({
            uid: `generated:${player.id}:${this.generatedCardCount}:${cardId}`,
            definition,
        });
        this.note(`${player.id} | signature_added_to_hand:${cardId}:${source.definition.card_id}`);
    }
    resolveEndPhaseTriggers(player) {
        const opponent = this.opponent(player);
        const signatureProviders = [...player.battlefield].filter((card) => card.definition.card_kind === "agent" &&
            card.definition.signature_card_id);
        const breachProviders = [...opponent.battlefield].filter((card) => card.definition.card_kind === "agent" &&
            (card.definition.breach ?? 0) > 0);
        for (const provider of signatureProviders) {
            if (this.winner !== undefined) {
                return;
            }
            this.addSignatureToHand(player, provider.definition.signature_card_id, provider);
        }
        for (const provider of breachProviders) {
            if (this.winner !== undefined) {
                return;
            }
            const amount = Math.max(0, provider.definition.breach ?? 0);
            if (!amount || !this.act(opponent, `resolve breach ${provider.definition.card_id}`)) {
                continue;
            }
            this.note(`${opponent.id} | breach:${provider.definition.card_id}:${amount}`);
            this.dealDamage(opponent, player, amount, provider);
        }
    }
    recoverRandomDiscard(player, amount, source) {
        let recovered = 0;
        for (let index = 0; index < Math.max(0, amount); index++) {
            if (!player.discard.length || this.winner !== undefined) {
                break;
            }
            const card = player.discard[this.rng.int(player.discard.length)];
            if (card && this.move(player, card, player.discard, player.deck, "discard", "deck")) {
                recovered++;
            }
        }
        if (recovered) {
            this.note(`${player.id} | discard_recovered:${recovered}:${source}`);
            const recoveredEventIndex = this.log.length - 1;
            this.shuffleDeck(player);
            this.snapshotDeck(player, recoveredEventIndex);
        }
    }
    destroyRandomOpponentDaemon(player, source) {
        const opponent = this.opponent(player);
        const candidates = opponent.battlefield.filter((card) => card.definition.card_kind === "daemon" && !card.definition.immutable);
        if (!candidates.length) {
            return;
        }
        const target = candidates[this.rng.int(candidates.length)];
        if (target) {
            this.deleteDaemon(opponent, target);
            this.note(`${player.id} | destroy_random_daemon:${target.definition.card_id}:${source}`);
        }
    }
    dealDamage(source, target, amount, causingCard) {
        const damage = Math.max(0, amount);
        if (!damage) {
            return;
        }
        const agents = target.battlefield.filter((card) => card.definition.card_kind === "agent" && card.remaining_integrity !== undefined);
        const destroyable = agents.filter((card) => (card.remaining_integrity ?? 0) <= damage);
        const candidates = destroyable.length
            ? destroyable
            : agents.filter((card) => (card.remaining_integrity ?? 0) === Math.min(...agents.map((agent) => agent.remaining_integrity ?? 0)));
        if (!candidates.length) {
            this.note(`${target.id} | damage:${damage}:sync`);
            this.changeSync(target, -damage, causingCard);
            return;
        }
        const agent = candidates[this.rng.int(candidates.length)];
        if (!this.act(source, `deal ${damage} damage to ${agent.uid}`)) {
            return;
        }
        agent.remaining_integrity = Math.max(0, (agent.remaining_integrity ?? 0) - damage);
        this.note(`${target.id} | agent_damaged:${agent.definition.card_id}:${damage}:${agent.remaining_integrity}`);
        if (agent.remaining_integrity === 0 && this.move(target, agent, target.battlefield, target.discard, "battlefield", "discard")) {
            this.note(`${target.id} | agent_deleted:${agent.definition.card_id}`);
        }
    }
    formPreparedSign(player, prepared, reason) {
        const signs = prepared.definition.signs ?? [];
        const formed = prepared.formed_signs ?? 0;
        const sign = signs[formed];
        if (!sign) {
            return;
        }
        prepared.formed_signs = formed + 1;
        this.note(`${player.id} | handseal:${prepared.definition.card_id}:${SIGN_LABELS[sign]}:${prepared.formed_signs}:${signs.length}:${reason}`);
    }
    formPreparedSigns(player, source) {
        if (!player.preparedJutsu.length) {
            return;
        }
        const prepared = player.preparedJutsu[0];
        const signs = prepared.definition.signs ?? [];
        const formed = prepared.formed_signs ?? 0;
        if (!signs[formed]) {
            return;
        }
        const matchingSign = CARD_KIND_SIGN[source.definition.card_kind];
        if (signs[formed] === matchingSign) {
            this.formPreparedSign(player, prepared, "matching");
            if (player.preparedJutsu[0] === prepared && this.winner === undefined) {
                this.formPreparedSign(player, prepared, "base");
            }
        }
        else {
            this.formPreparedSign(player, prepared, "base");
            if (player.preparedJutsu[0] === prepared &&
                this.winner === undefined &&
                signs[prepared.formed_signs ?? 0] === matchingSign) {
                this.formPreparedSign(player, prepared, "matching");
            }
        }
        if (player.preparedJutsu[0] === prepared &&
            this.winner === undefined &&
            (prepared.formed_signs ?? 0) >= signs.length) {
            this.resolvePreparedJutsu(player, prepared);
        }
    }
    resolvePreparedJutsu(player, prepared) {
        if (player.preparedJutsu[0] !== prepared || this.winner !== undefined) {
            return;
        }
        this.note(`${player.id} | prepared_jutsu_complete:${prepared.definition.card_id}`);
        if (!this.move(player, prepared, player.preparedJutsu, player.battlefield, "prepared", "battlefield") ||
            !this.act(player, `resolve prepared ${prepared.definition.card_id}`)) {
            return;
        }
        this.resolve(player, prepared);
        if (this.winner === undefined) {
            if (this.move(player, prepared, player.battlefield, player.discard, "battlefield", "discard")) {
                this.note(`${player.id} | prepared_jutsu_deleted:${prepared.definition.card_id}`);
            }
        }
    }
    createAgents(player, amount, displayName, integrity, source) {
        const count = Math.max(0, amount);
        const startingIntegrity = Math.max(0, integrity);
        let created = 0;
        const tokenId = `token:${displayName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
        const definition = {
            card_id: tokenId,
            display_name: displayName,
            effect: "",
            card_kind: "agent",
            integrity: startingIntegrity,
        };
        for (let index = 0; index < count && this.winner === undefined; index++) {
            if (!this.act(player, `create ${displayName} Agent`)) {
                break;
            }
            this.generatedCardCount++;
            player.battlefield.push({
                uid: `generated:${player.id}:${this.generatedCardCount}:${tokenId}`,
                definition,
                remaining_integrity: startingIntegrity,
            });
            created++;
        }
        if (created) {
            this.note(`${player.id} | agents_created:${created}:${displayName}:${startingIntegrity}:${source}`);
        }
    }
    preventersFor(event) {
        return this.opponent(event.recipient).battlefield.filter((card) => card.definition.mechanics?.some((mechanic) => mechanic.type === "prevent_next_opponent_flux_gain"));
    }
    playReaction(player, event) {
        for (const rule of player.reactions) {
            if (event.recipient === player) {
                continue;
            }
            const card = player.hand.find((instance) => instance.definition.card_id === rule.action_card_id);
            if (!card ||
                !card.definition.reaction_triggers?.includes(rule.trigger_type) ||
                !compare(event.amount, rule.comparison_operator, rule.quantity_threshold)) {
                continue;
            }
            if (!this.canPayCosts(player, card.definition)) {
                continue;
            }
            this.note(`${player.id} | reaction_play:${rule.trigger_type}:${card.definition.card_id}:${event.recipient.id}`);
            if (!this.payCosts(player, card.definition) ||
                !this.move(player, card, player.hand, player.discard, "hand", "discard")) {
                continue;
            }
            this.act(player, `resolve reaction ${card.definition.card_id}`);
            if (card.definition.mechanics?.some((mechanic) => mechanic.type === "prevent_triggering_event")) {
                event.prevented = true;
                this.note(`${event.recipient.id} | flux_gain_prevented:${event.amount}:${card.definition.card_id}:discarded`);
            }
            this.formPreparedSigns(player, card);
            return true;
        }
        return false;
    }
    react(event) {
        let priority = this.players[this.active];
        let passes = 0;
        while (this.winner === undefined && !event.prevented && passes < 2) {
            if (this.playReaction(priority, event)) {
                passes = 0;
            }
            else {
                passes++;
            }
            priority = this.opponent(priority);
        }
    }
    gain(player, amount, bonus = true, source) {
        const gain = Math.max(0, amount);
        if (!gain) {
            return;
        }
        const event = {
            type: "opponent_would_gain_flux",
            recipient: player,
            amount: gain,
            source,
        };
        this.note(`${player.id} | pending_flux_gain:${gain}:${source ?? ""}`);
        const preventers = this.preventersFor(event);
        if (preventers.length) {
            event.prevented = true;
            this.note(`${player.id} | flux_gain_prevented:${gain}:${preventers[0].definition.card_id}:deleted`);
            for (const [index, preventer] of preventers.entries()) {
                const owner = this.opponent(player);
                if (index > 0) {
                    this.note(`${owner.id} | prevention_no_effect:${preventer.definition.card_id}`);
                }
                this.move(owner, preventer, owner.battlefield, owner.discard, "battlefield", "discard");
            }
        }
        else {
            this.react(event);
        }
        if (this.winner !== undefined || event.prevented) {
            return;
        }
        const before = player.points;
        this.changePoints(player, gain, source);
        const applied = player.points - before;
        if (applied && bonus) {
            const bonuses = [];
            for (const daemon of player.battlefield) {
                for (const mechanic of daemon.definition.mechanics ?? []) {
                    if (mechanic.type === "first_flux_gain_bonus" &&
                        !this.mechanicTriggeredThisTurn(daemon, mechanic.type)) {
                        bonuses.push({ daemon, amount: mechanic.amount });
                    }
                }
            }
            for (const { daemon, amount } of bonuses) {
                this.markMechanicTriggeredThisTurn(daemon, "first_flux_gain_bonus");
                this.gain(player, amount, false, `bonus:${daemon.definition.card_id}`);
            }
        }
    }
    scanDeck(player, count, cardIds, source) {
        const lookedAt = player.deck.slice(0, Math.max(0, count));
        const matches = new Set(cardIds);
        let found = 0;
        for (const card of lookedAt) {
            if (this.winner !== undefined) {
                return;
            }
            if (matches.has(card.definition.card_id) && this.move(player, card, player.deck, player.hand, "deck", "hand")) {
                found++;
            }
        }
        for (const card of lookedAt) {
            if (this.winner !== undefined) {
                return;
            }
            if (!matches.has(card.definition.card_id)) {
                this.move(player, card, player.deck, player.deck, "deck", "deck");
            }
        }
        this.note(`${player.id} | scan_deck:${lookedAt.length}:${found}:${cardIds.join(",")}:${source}`);
        this.snapshotDeck(player);
    }
    resolveConditionalHandEffect(player) {
        if (player.hand.length === 0) {
            let drawn = 0;
            const drawnCards = [];
            for (let i = 0; i < 2 && this.winner === undefined; i++) {
                drawn += Number(this.draw(player, false, drawnCards));
            }
            if (drawn) {
                this.note(`${player.id} | draw_many:${drawn}`);
                this.snapshotDraw(player, drawnCards);
            }
            return;
        }
        this.discardRandomCard(player);
    }
    discardRandomCard(player) {
        if (!player.hand.length) {
            return;
        }
        const discarded = player.hand[this.rng.int(player.hand.length)];
        if (discarded && this.move(player, discarded, player.hand, player.discard, "hand", "discard")) {
            this.note(`${player.id} | discard_random:${discarded.definition.card_id}`);
        }
    }
    snapshot(player, phase) {
        if (!this.captureLog) {
            return;
        }
        this.turnSnapshots.push({
            turn: this.turnCount,
            player: player.id,
            phase,
            deckCount: player.deck.length,
            hand: player.hand.map((card) => card.definition.card_id),
            deck: player.deck.map((card) => card.definition.card_id),
            board: player.battlefield.map((card) => card.definition.card_id),
            discard: player.discard.map((card) => card.definition.card_id),
            void: player.void.map((card) => card.definition.card_id),
            flux: player.points,
            sync: player.sync,
            uplink: player.uplink,
            bandwidth: player.bandwidth,
            bandwidthMax: player.maxBandwidth,
            ki: player.ki,
        });
    }
    resolvePlayTriggers(player, playedCard) {
        const triggers = player.battlefield.filter((card) => card !== playedCard &&
            card.definition.card_id === playedCard.definition.card_id &&
            !this.mechanicTriggeredThisTurn(card, "draw_when_another_copy_played") &&
            card.definition.mechanics?.some((mechanic) => mechanic.type === "draw_when_another_copy_played"));
        for (const trigger of triggers) {
            if (this.winner !== undefined || !this.act(player, `resolve triggered ${trigger.definition.card_id}`)) {
                return;
            }
            this.markMechanicTriggeredThisTurn(trigger, "draw_when_another_copy_played");
            const drawnCards = [];
            if (this.draw(player, false, drawnCards)) {
                this.note(`${player.id} | triggered_draw:${trigger.definition.card_id}`);
                this.snapshotDraw(player, drawnCards);
            }
        }
    }
    playTopCardOfDeck(player, source) {
        const opponent = this.opponent(player);
        const card = opponent.deck[0];
        if (!card || !this.canPlayRestrictions(opponent, card)) {
            return;
        }
        if (!this.move(opponent, card, opponent.deck, opponent.hand, "deck", "hand")) {
            return;
        }
        this.snapshotDeck(opponent);
        if (!this.canPayCosts(opponent, card.definition)) {
            this.note(`${opponent.id} | forced_play_discarded:${card.definition.card_id}:${source}`);
            this.move(opponent, card, opponent.hand, opponent.discard, "hand", "discard");
            return;
        }
        this.note(`${opponent.id} | play_top_card:${card.definition.card_id}:${source}`);
        this.play(opponent, card, true);
    }
    resolve(player, card) {
        for (const mechanic of card.definition.mechanics ?? []) {
            if (this.winner !== undefined) {
                return;
            }
            if (mechanic.type === "gain_flux") {
                this.gain(player, mechanic.amount);
            }
            else if (mechanic.type === "gain_ki") {
                this.gainKi(player, mechanic.amount);
            }
            else if (mechanic.type === "deal_damage") {
                this.dealDamage(player, this.opponent(player), mechanic.amount, card);
            }
            else if (mechanic.type === "remove_opponent_victory_points") {
                this.changePoints(this.opponent(player), -mechanic.amount);
            }
            else if (mechanic.type === "gain_victory_points_if_at_most") {
                if (player.points <= mechanic.threshold) {
                    this.gain(player, mechanic.amount);
                }
                else {
                    this.note(`${player.id} | conditional_flux_effect_failed`);
                }
            }
            else if (mechanic.type === "remove_opponent_sync") {
                this.changeSync(this.opponent(player), -mechanic.amount, card);
            }
            else if (mechanic.type === "remove_own_sync") {
                this.changeSync(player, -mechanic.amount);
            }
            else if (mechanic.type === "scan_deck") {
                this.scanDeck(player, mechanic.count, mechanic.card_ids, card.definition.card_id);
            }
            else if (mechanic.type === "draw_two_if_hand_empty_otherwise_discard_random") {
                this.resolveConditionalHandEffect(player);
            }
            else if (mechanic.type === "discard_random_card") {
                this.discardRandomCard(mechanic.target === "opponent" ? this.opponent(player) : player);
            }
            else if (mechanic.type === "set_own_sync_and_draw_half_deck") {
                this.setSync(player, mechanic.sync);
                const drawCount = Math.floor(player.deck.length / 2);
                let drawn = 0;
                const drawnCards = [];
                for (let i = 0; i < drawCount && this.winner === undefined; i++) {
                    drawn += Number(this.draw(player, false, drawnCards));
                }
                if (drawn) {
                    this.note(`${player.id} | draw_many:${drawn}`);
                    this.snapshotDraw(player, drawnCards);
                }
            }
            else if (mechanic.type === "end_own_turn") {
                if (this.phase === "pregame") {
                    this.note(`${player.id} | pregame_end_turn_effect`);
                }
                else {
                    this.phase = "end";
                    this.note(`${player.id} | end_turn_effect`);
                }
            }
            else if (mechanic.type === "queue_extra_turn") {
                this.extraTurns[this.players.indexOf(player)].push(card.definition.card_id);
                this.note(`${player.id} | extra_turn_queued:${card.definition.card_id}`);
            }
            else if (mechanic.type === "draw_when_another_copy_played") {
                // This is a triggered ability. It resolves when another copy enters play.
            }
            else if (mechanic.type === "destroy_random_opponent_daemon") {
                this.destroyRandomOpponentDaemon(player, card.definition.card_id);
            }
            else if (mechanic.type === "recover_random_discard") {
                this.recoverRandomDiscard(player, mechanic.amount, card.definition.card_id);
            }
            else if (mechanic.type === "wipe_this_card") {
                this.wipe(player, card);
            }
            else if (mechanic.type === "add_cards_to_deck") {
                this.addCardsToDeck(player, mechanic.card_id, mechanic.amount, mechanic.shuffle, card.definition.card_id);
            }
            else if (mechanic.type === "gain_own_sync") {
                this.changeSync(player, mechanic.amount);
            }
            else if (mechanic.type === "play_top_card_of_opponent_deck") {
                this.playTopCardOfDeck(player, card.definition.card_id);
            }
            else if (mechanic.type === "opponent_sync_loss_bonus") {
                // Persistent trigger; it is applied by resolveSyncLossBonuses.
            }
            else if (mechanic.type === "create_agents") {
                this.createAgents(player, mechanic.amount, mechanic.display_name, mechanic.integrity, card.definition.card_id);
            }
        }
    }
    play(player, card, fromDeck = false) {
        if (!this.canPlay(player, card)) {
            return false;
        }
        if (!fromDeck) {
            this.note(`${player.id} | play:${card.definition.card_id}`);
        }
        if (!this.payCosts(player, card.definition)) {
            return false;
        }
        if (card.definition.jutsu) {
            if (!this.move(player, card, player.hand, player.preparedJutsu, "hand", "prepared")) {
                return false;
            }
            if (this.phase === "main") {
                player.cardsPlayedThisTurn++;
            }
            this.note(`${player.id} | jutsu_prepared:${card.definition.card_id}`);
            return this.winner === undefined;
        }
        if (!this.move(player, card, player.hand, player.battlefield, "hand", "battlefield")) {
            return false;
        }
        if (this.phase === "main") {
            player.cardsPlayedThisTurn++;
        }
        this.act(player, `resolve ${card.definition.card_id}`);
        this.resolve(player, card);
        this.resolvePlayTriggers(player, card);
        this.formPreparedSigns(player, card);
        if (card.definition.card_kind === "pulse") {
            this.move(player, card, player.battlefield, player.discard, "battlefield", "discard");
        }
        if (player.points >= this.config.victory_points_to_win) {
            this.finish(player.id, "flux");
        }
        return this.winner === undefined;
    }
    activate(player, card) {
        if (!this.canActivate(player, card)) {
            return false;
        }
        this.note(`${player.id} | activate:${card.definition.card_id}`);
        if (!this.payCosts(player, card.definition)) {
            return false;
        }
        player.cardsPlayedThisTurn++;
        this.act(player, `resolve ${card.definition.card_id}`);
        this.resolve(player, card);
        if (player.points >= this.config.victory_points_to_win) {
            this.finish(player.id, "flux");
        }
        return this.winner === undefined;
    }
    randomCandidates(player, restricted = false) {
        return (restricted
            ? player.hand.filter((card) => !player.random_card_ids ||
                player.random_card_ids.includes(card.definition.card_id))
            : player.hand).filter((card) => card.definition.card_kind !== "glitch" && !card.definition.immutable);
    }
    canAct(player, rule) {
        if (rule.action_type === "end_turn") {
            return true;
        }
        if (rule.action_type === "play_random_card") {
            return this.randomCandidates(player, rule.default_random).some((card) => this.canPlay(player, card));
        }
        if (rule.action_type === "play_combo") {
            return (rule.action_card_ids ?? []).some((cardId) => player.hand.some((card) => card.definition.card_id === cardId && this.canPlay(player, card)));
        }
        if (rule.action_type === "activate_immutable_card") {
            return player.battlefield.some((card) => card.definition.card_id === rule.action_card_id &&
                this.canActivate(player, card));
        }
        return player.hand.some((card) => card.definition.card_id === rule.action_card_id &&
            this.canPlay(player, card));
    }
    action(player, rule) {
        this.canceledComboRule = undefined;
        if (!this.canAct(player, rule)) {
            return false;
        }
        if (rule.action_type === "end_turn") {
            this.phase = "end";
            this.note(`${player.id} | end_turn_action`);
            return false;
        }
        if (rule.action_type === "play_random_card") {
            const choices = this.randomCandidates(player, rule.default_random).filter((card) => this.canPlay(player, card));
            const card = choices[this.rng.int(choices.length)];
            return !!card && this.play(player, card);
        }
        if (rule.action_type === "play_combo") {
            const allCards = new Set(rule.action_card_all_ids ?? []);
            let playedAny = false;
            for (const cardId of rule.action_card_ids ?? []) {
                let playedThisCard = 0;
                while (true) {
                    const card = player.hand.find((instance) => instance.definition.card_id === cardId);
                    if (!card || !this.canPlay(player, card)) {
                        if (rule.cancel_if_card_not_played && playedThisCard === 0) {
                            this.canceledComboRule = rule;
                            return false;
                        }
                        break;
                    }
                    const played = this.play(player, card);
                    if (played) {
                        playedAny = true;
                        playedThisCard++;
                    }
                    if (this.winner !== undefined || this.phase !== "main") {
                        return played;
                    }
                    if (!played) {
                        if (rule.cancel_if_card_not_played && playedThisCard === 0) {
                            this.canceledComboRule = rule;
                            return false;
                        }
                        break;
                    }
                    if (!allCards.has(cardId)) {
                        break;
                    }
                }
            }
            return playedAny;
        }
        if (rule.action_type === "activate_immutable_card") {
            const card = player.battlefield.find((instance) => instance.definition.card_id === rule.action_card_id &&
                this.canActivate(player, instance));
            return !!card && this.activate(player, card);
        }
        const card = player.hand.find((instance) => instance.definition.card_id === rule.action_card_id &&
            this.canPlay(player, instance));
        return !!card && this.play(player, card);
    }
    matching(player, rule) {
        const opponent = this.opponent(player);
        const quantityKey = normalizedQuantity(rule);
        const quantity = quantityKey === "cards_in_your_deck"
            ? player.deck.length
            : quantityKey === "cards_in_opponent_deck"
                ? opponent.deck.length
                : quantityKey === "cards_in_your_hand"
                    ? player.hand.length
                    : quantityKey === "cards_in_opponent_hand"
                        ? opponent.hand.length
                        : quantityKey === "cards_on_your_board"
                            ? player.battlefield.length
                            : quantityKey === "cards_on_opponent_board"
                                ? opponent.battlefield.length
                                : quantityKey === "your_flux"
                                    ? player.points
                                    : quantityKey === "opponent_flux"
                                        ? opponent.points
                                        : quantityKey === "your_ki"
                                            ? player.ki
                                            : quantityKey === "opponent_ki"
                                                ? opponent.ki
                                                : quantityKey === "your_bandwidth"
                                                    ? player.bandwidth
                                                    : quantityKey === "opponent_bandwidth"
                                                        ? opponent.bandwidth
                                                        : quantityKey === "your_sync"
                                                            ? player.sync
                                                            : quantityKey === "opponent_sync"
                                                                ? opponent.sync
                                                                : 0;
        const condition = rule.condition_type === "if_able"
            ? true
            : rule.condition_type === "card_in_hand"
                ? player.hand.some((card) => card.definition.card_id === rule.condition_card_id)
                : rule.condition_type === "card_is"
                    ? (rule.card_condition === "in_your_hand"
                        ? player.hand
                        : rule.card_condition === "on_your_side_of_board"
                            ? player.battlefield
                            : opponent.battlefield).some((card) => card.definition.card_id === rule.condition_card_id)
                    : rule.condition_type === "quantity_compare"
                        ? compare(quantity, rule.comparison_operator ?? "<", rule.quantity_threshold ?? 0)
                        : rule.condition_type === "own_victory_points_at_most"
                            ? player.points <= (rule.victory_points_threshold ?? 0)
                            : rule.condition_type === "opponent_victory_points_at_most"
                                ? opponent.points <= (rule.victory_points_threshold ?? 0)
                                : rule.condition_type === "opponent_sync_at_most"
                                    ? opponent.sync <= (rule.victory_points_threshold ?? 0)
                                    : opponent.points >= (rule.victory_points_threshold ?? 0);
        return condition && this.canAct(player, rule);
    }
    takeTurn() {
        this.turnCount++;
        const player = this.players[this.active];
        const index = this.players.indexOf(player);
        const extraTurnSource = this.extraTurns[index].shift();
        this.snapshot(player, "before_start");
        for (const phase of ["start", "draw", "main", "end"]) {
            if (this.winner !== undefined) {
                return;
            }
            this.phase = phase;
            this.act(player, `${player.id} enters ${phase} phase`);
            if (phase === "start") {
                player.cardsPlayedThisTurn = 0;
                this.note(`${player.id} | ${extraTurnSource ? `turn_start:extra_turn:${extraTurnSource}` : "turn_start"}`);
                this.gainUplink(player, 1);
                this.increaseBandwidthMaxAndRestore(player, 1);
                this.snapshot(player, "start");
            }
            else if (phase === "draw") {
                this.draw(player);
                this.snapshot(player, "draw_end");
            }
            else if (phase === "main") {
                this.runMainPhase(player);
            }
            else {
                this.resolveEndPhaseTriggers(player);
                if (this.winner === undefined) {
                    this.note(`${player.id} | turn_end`);
                }
            }
        }
        if (this.extraTurns[index].length === 0) {
            this.active = (1 - this.active);
        }
    }
    runMainPhase(player) {
        let canceledRule;
        while (this.winner === undefined &&
            this.phase === "main" &&
            (player.hand.length ||
                player.battlefield.some((card) => card.definition.immutable))) {
            const rule = player.program.find((candidate) => candidate !== canceledRule && this.matching(player, candidate));
            const action = rule ?? {
                condition_type: "if_able",
                action_type: player.default_action,
                default_random: true,
            };
            if (!this.action(player, action)) {
                if (rule !== undefined && this.canceledComboRule === rule) {
                    canceledRule = rule;
                    continue;
                }
                break;
            }
            canceledRule = undefined;
        }
    }
    finish(winner, reason) {
        if (this.winner !== undefined) {
            return;
        }
        this.winner = winner;
        this.reason = reason;
        this.note(`system | battle_end:${winner ?? "draw"}:${reason}`);
    }
    resolvePregameImmutableCards() {
        this.phase = "pregame";
        this.note("system | pregame_start");
        const ordered = [this.players[this.active], this.opponent(this.players[this.active])];
        for (const player of ordered) {
            for (const card of [...player.hand]) {
                if (!card.definition.immutable || this.winner !== undefined) {
                    continue;
                }
                this.note(`${player.id} | play:${card.definition.card_id}`);
                this.move(player, card, player.hand, player.battlefield, "hand", "battlefield");
            }
        }
    }
    run() {
        if (this.scenarioSetup) {
            const player = this.players[this.active];
            this.phase = this.scenarioSetup.phase ?? "main";
            this.note(`${player.id} | turn_start`);
            this.act(player, `${player.id} enters ${this.phase} phase`);
            if (this.phase === "main") {
                this.runMainPhase(player);
            }
            else {
                this.resolveEndPhaseTriggers(player);
            }
            if (this.winner === undefined) {
                this.finish(null, "scenario_complete");
            }
            return this.record(1, 0);
        }
        this.resolvePregameImmutableCards();
        while (this.winner === undefined) {
            this.takeTurn();
        }
        return this.record(1, 0);
    }
    record(game_number, seed) {
        const [first, second] = this.players;
        const record = {
            game_number,
            seed,
            starting_player: this.starting_player,
            turn_count: this.turnCount,
            winner_id: this.winner ?? null,
            end_reason: this.reason,
            first_victory_points: first.points,
            second_victory_points: second.points,
            log: this.log,
        };
        if (this.captureLog) {
            record.turnSnapshots = this.turnSnapshots;
            record.deckSnapshots = this.deckSnapshots;
            record.drawEvents = this.drawEvents;
        }
        return record;
    }
}
export function replayBattle(first, second, cards, seed, config = DEFAULT_CONFIG, startingPlayer = 0, scenarioSetup, captureLog = true) {
    const battle = new Battle(first, second, cards, config, new Rng(seed), captureLog, scenarioSetup);
    battle.active = scenarioSetup?.active_player ?? startingPlayer;
    battle.starting_player = startingPlayer;
    return battle.run();
}
export function simulateMatch(first, second, cards, games, seed = 1, config = DEFAULT_CONFIG) {
    const master = new Rng(seed);
    const battles = [];
    let wins = 0;
    let losses = 0;
    for (let i = 0; i < games; i++) {
        const battleSeed = (master.next() * 0x100000000) >>> 0;
        const battle = new Battle(first, second, cards, config, new Rng(battleSeed), false);
        battle.active = (i % 2);
        battle.starting_player = battle.active;
        const { log: _log, ...record } = battle.run();
        battles.push({ ...record, game_number: i + 1, seed: battleSeed });
        if (record.winner_id === "first") {
            wins++;
        }
        else if (record.winner_id === "second") {
            losses++;
        }
    }
    return {
        battles,
        wins,
        losses,
        draws: games - wins - losses,
    };
}
