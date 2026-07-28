const parts = (event) => { const [actor, detail = ""] = event.split(" | "); return { actor, detail }; };
const plural = (count, noun) => `${noun}${count === "1" ? "" : "s"}`;
export function isTurnStartEvent(event) { return parts(event).detail.startsWith("turn_start"); }
/** Keep engine setup diagnostics out of player turn navigation. */
export function groupBattleLogByTurn(events) {
    const turns = [];
    let current;
    for (const event of events) {
        if (isTurnStartEvent(event)) {
            current = [];
            turns.push(current);
        }
        if (current)
            current.push(event);
    }
    return turns;
}
export function narrateBattleEvent(event, context) {
    const { actor, detail } = parts(event), player = context.player(actor);
    if (detail === "turn_start")
        return `${player} begins their turn.`;
    if (detail.startsWith("turn_start:extra_turn:"))
        return `${player} begins their extra turn from ${context.card(detail.split(":")[2])}.`;
    if (detail === "draw")
        return `${player} draws a card.`;
    if (detail.startsWith("draw_many:"))
        return `${player} draws ${detail.split(":")[1]} cards.`;
    if (detail.startsWith("play:"))
        return `${player} plays ${context.card(detail.split(":")[1])}.`;
    if (detail.startsWith("scan_deck:")) {
        const [, looked, found, ids, source] = detail.split(":"), cardIds = ids.split(","), target = cardIds.length === 1 ? `${context.card(cardIds[0])} ${plural(found, "card")}` : "matching cards";
        return `${player} uses ${context.card(source)} to look at the top ${looked} cards and adds ${found} ${target} to their hand.`;
    }
    if (detail.startsWith("reaction_play:")) {
        const [, trigger, cardId, recipient] = detail.split(":"), response = trigger === "opponent_would_gain_flux" ? `${context.player(recipient)} gaining Flux` : "the triggering event";
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
        const [, amount, current] = detail.split(":"), value = Number(amount);
        if (!value)
            return "";
        return `${player} ${value > 0 ? "gains " : "loses "}${Math.abs(value)} Sync. <span class="log-total">(${current}/20)</span>`;
    }
    if (detail === "end_turn_effect")
        return `${player} ended their turn from a card effect.`;
    if (detail === "end_turn_action")
        return `${player} ended their turn.`;
    if (event.startsWith("system | battle_end:")) {
        const [, winner, reason] = event.split(":");
        return winner === "draw" ? `The battle ended in a draw (${reason}).` : `${context.player(winner)} won by ${reason}.`;
    }
    return "";
}
