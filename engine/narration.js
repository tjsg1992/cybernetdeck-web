const parts = (event) => { const [actor, detail = ""] = event.split(" | "); return { actor, detail }; };
const plural = (count, noun) => `${noun}${count === "1" ? "" : "s"}`;
const deck = (context, playerId) => context.deck?.(playerId) ?? "Deck";
const drawn = (context, playerId, label, fallback) => context.drawnCardIds?.length && context.drawnCards ? context.drawnCards(label, context.drawnCardIds, playerId) : fallback;
export function isTurnStartEvent(event) { return parts(event).detail.startsWith("turn_start"); }
/** Keep engine setup diagnostics out of player turn navigation. */
export function groupBattleLogByTurn(events) {
    const turns = [], pregame = [];
    let current;
    for (const event of events) {
        if (isTurnStartEvent(event)) {
            current = [];
            turns.push(current);
        }
        (current ?? pregame).push(event);
    }
    return pregame.some((event) => event.includes(" | play:")) ? [pregame, ...turns] : turns;
}
export function narrateBattleEvent(event, context) {
    const { actor, detail } = parts(event), player = context.player(actor);
    if (detail === "turn_start")
        return `${player} begins their turn.`;
    if (detail.startsWith("turn_start:extra_turn:"))
        return `${player} begins their extra turn from ${context.card(detail.split(":")[2])}.`;
    if (detail === "draw")
        return `${player} draws ${context.drawnCardIds?.length === 1 ? context.card(context.drawnCardIds[0]) : drawn(context, actor, "a card", "a card")}.`;
    if (detail.startsWith("draw_many:")) {
        const count = detail.split(":")[1];
        if (context.drawnCardIds?.length === 1)
            return `${player} draws ${context.card(context.drawnCardIds[0])}.`;
        return `${player} draws ${drawn(context, actor, `${count} ${plural(count, "card")}`, `${count} ${plural(count, "card")}`)}.`;
    }
    if (detail.startsWith("triggered_draw:")) {
        const source = context.card(detail.split(":")[1]);
        const count = context.drawnCardIds?.length ?? 0;
        const subject = count === 1 ? context.card(context.drawnCardIds[0]) : drawn(context, actor, `${count} cards`, "a card");
        return `${player} draws ${subject} from ${source}.`;
    }
    if (detail.startsWith("discard_random:"))
        return `${player} discards ${context.card(detail.split(":")[1])} at random.`;
    if (detail === "discard_random")
        return `${player} discards a card at random.`;
    if (detail.startsWith("forced_play_discarded:")) {
        const [, cardId, source] = detail.split(":");
        return `${player} cannot pay the cost of ${context.card(cardId)} forced by ${context.card(source)}, so it is discarded.`;
    }
    if (detail.startsWith("play_top_card:")) {
        const [, cardId, source] = detail.split(":");
        return `${player} plays the top card of their ${deck(context, actor)}, ${context.card(cardId)}, from ${context.card(source)}.`;
    }
    if (detail.startsWith("signature_added_to_hand:")) {
        const [, cardId, source] = detail.split(":");
        return `${player} adds ${context.card(cardId)} to their hand from ${context.card(source)}.`;
    }
    if (detail.startsWith("breach:")) {
        const [, source, amount] = detail.split(":");
        return `${player}'s ${context.card(source)} resolves Breach ${amount}.`;
    }
    if (detail.startsWith("jutsu_prepared:"))
        return `${player} prepares ${context.card(detail.split(":")[1])} beneath Ninjutsu.`;
    if (detail.startsWith("handseal:")) {
        const [, cardId, sign, formed, total] = detail.split(":");
        return `${player} forms ${sign} for ${context.card(cardId)} (${formed}/${total} Signs).`;
    }
    if (detail.startsWith("prepared_jutsu_complete:"))
        return `${player} completes ${context.card(detail.split(":")[1])}.`;
    if (detail.startsWith("agents_created:")) {
        const [, amount, name, integrity] = detail.split(":");
        return `${player} creates ${amount} ${name} Agents with ${integrity} Integrity.`;
    }
    if (detail.startsWith("play:"))
        return `${player} plays ${context.card(detail.split(":")[1])}.`;
    if (detail.startsWith("activate:"))
        return `${player} activates ${context.card(detail.split(":")[1])}.`;
    if (detail.startsWith("ki:")) {
        const [, amount, current] = detail.split(":"), value = Number(amount);
        return `${player} gains ${value} Ki. <span class="log-total">(${current})</span>`;
    }
    if (detail.startsWith("uplink:")) {
        const [, amount, current] = detail.split(":"), value = Number(amount);
        return `${player} gains ${value} Uplink. <span class="log-total">(${current})</span>`;
    }
    if (detail.startsWith("bandwidth:")) {
        const [, amount, _current, max] = detail.split(":"), value = Number(amount);
        return `${player} gains ${value} Bandwidth. <span class="log-total">(${max})</span>`;
    }
    if (detail.startsWith("bandwidth_paid:")) {
        const [, amount, current, max] = detail.split(":"), value = Number(amount);
        return `${player} spends ${value} Bandwidth. <span class="log-total">(${current}/${max})</span>`;
    }
    if (detail.startsWith("damage:"))
        return `${player} takes ${detail.split(":")[1]} damage directly to Sync.`;
    if (detail.startsWith("agent_damaged:")) {
        const [, cardId, amount, integrity] = detail.split(":");
        return `${context.card(cardId)} takes ${amount} damage and has ${integrity} Integrity remaining.`;
    }
    if (detail.startsWith("agent_deleted:"))
        return `${player}'s ${context.card(detail.split(":")[1])} is deleted.`;
    if (detail.startsWith("daemon_deleted:"))
        return `${player}'s ${context.card(detail.split(":")[1])} is deleted.`;
    if (detail === "pregame_end_turn_effect")
        return `${player}'s card effect has no turn to end before the battle begins.`;
    if (detail.startsWith("scan_deck:")) {
        const fields = detail.split(":"), looked = fields[1], found = fields[2];
        if (fields.length < 5)
            return `${player} looks at the top ${looked} cards and adds ${found} matching cards to their hand.`;
        const [, _, __, ids, source] = fields, cardIds = ids.split(","), target = cardIds.length === 1 ? `${context.card(cardIds[0])} ${plural(found, "card")}` : "matching cards";
        return `${player} uses ${context.card(source)} to look at the top ${looked} cards and adds ${found} ${target} to their hand.`;
    }
    if (detail.startsWith("cards_added_to_deck:")) {
        const [, amount, cardId, source, order] = detail.split(":"), targetDeck = deck(context, actor);
        return `${player} uses ${context.card(source)} to add ${amount} ${context.card(cardId)} ${plural(amount, "card")} to their ${targetDeck}${order === "shuffled" ? ` and shuffles their ${targetDeck}` : ""}.`;
    }
    if (detail.startsWith("add_to_deck_rejected_signature:")) {
        const [, cardId, source] = detail.split(":");
        return `${player} cannot add Signature ${context.card(cardId)} to their Deck from ${context.card(source)}.`;
    }
    if (detail.startsWith("discard_recovered:")) {
        const [, amount] = detail.split(":");
        return `${player} shuffles ${amount} ${plural(amount, "card")} from their Discard into their ${deck(context, actor)}.`;
    }
    if (detail === "shuffle deck")
        return `${player} shuffles their ${deck(context, actor)}.`;
    if (detail.startsWith("wiped:"))
        return `${player} wipes ${context.card(detail.split(":")[1])} into the Void.`;
    if (detail.startsWith("reaction_play:")) {
        const fields = detail.split(":");
        if (fields.length === 3) {
            const [, cardId, amount] = fields;
            return `${player} plays ${context.card(cardId)} in response to the opponent gaining ${amount} Flux.`;
        }
        const [, trigger, cardId, recipient] = fields, response = trigger === "opponent_would_gain_flux" ? `${context.player(recipient)} gaining Flux` : "the triggering event";
        return `${player} plays ${context.card(cardId)} in response to ${response}.`;
    }
    if (detail.startsWith("flux_gain_prevented:")) {
        const [, amount, cardId, outcome] = detail.split(":"), ending = outcome === "deleted" ? " and is deleted." : outcome === "discarded" ? "." : ".";
        return `${player} would gain ${amount} Flux, but ${context.card(cardId)} prevents it${ending}`;
    }
    if (detail.startsWith("prevention_no_effect:"))
        return `${player} activates ${context.card(detail.split(":")[1])}, but the gain was already prevented, so it has no effect and is deleted.`;
    if (detail.startsWith("sync_set:")) {
        const [, value, _current, source] = detail.split(":");
        return `${player} activates ${context.card(source)} and sets their Sync to ${value}.`;
    }
    if (detail.startsWith("triggered_card_deleted:"))
        return `${player} deletes ${context.card(detail.split(":")[1])}.`;
    if (detail.startsWith("flux:")) {
        const [, amount, current, source] = detail.split(":"), value = Number(amount);
        if (!value)
            return "";
        const sentence = source === "bonus" ? `gains ${Math.abs(value)} additional Flux from ${context.card(detail.split(":")[4])}.` : `${value > 0 ? "gains " : "loses "}${Math.abs(value)} Flux.`;
        return `${player} ${sentence} <span class="log-total">(${current}/20)</span>`;
    }
    if (detail.startsWith("sync:")) {
        const [, amount, current, source] = detail.split(":"), value = Number(amount);
        if (!value)
            return "";
        const sentence = source === "bonus" ? `${value > 0 ? "gains " : "loses "}${Math.abs(value)} additional Sync from ${context.card(detail.split(":")[4])}.` : `${value > 0 ? "gains " : "loses "}${Math.abs(value)} Sync.`;
        return `${player} ${sentence} <span class="log-total">(${current}/20)</span>`;
    }
    if (detail === "end_turn_effect")
        return `${player} ended their turn from a card effect.`;
    if (detail === "end_turn_action")
        return `${player} ended their turn.`;
    if (event.startsWith("system | battle_end:")) {
        const [, winner, reason] = event.split(":");
        if (reason === "deck_exhausted" && winner !== "draw") {
            const loser = winner === "first" ? "second" : "first";
            return `${context.player(winner)} won when their opponent could not draw from their ${deck(context, loser)}.`;
        }
        return winner === "draw" ? `The battle ended in a draw (${reason}).` : `${context.player(winner)} won by ${reason}.`;
    }
    return "";
}
