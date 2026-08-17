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
        const [, cardId, source, deckOwner] = detail.split(":");
        if (deckOwner && deckOwner !== actor)
            return `${player} plays ${context.card(cardId)} from the top of ${context.player(deckOwner)}'s ${deck(context, deckOwner)} using ${context.card(source)}.`;
        return `${player} plays ${context.card(cardId)} from the top of their ${deck(context, actor)} using ${context.card(source)}.`;
    }
    if (detail.startsWith("forced_play_failed:")) {
        const [, cardId, source, fallback, deckOwner] = detail.split(":");
        const owner = deckOwner && deckOwner !== actor ? `${context.player(deckOwner)}'s ${deck(context, deckOwner)}` : `their ${deck(context, actor)}`;
        const destination = fallback === "bottom" ? `the bottom of ${owner}` : deckOwner && deckOwner !== actor ? `${context.player(deckOwner)}'s Discard` : `their Discard`;
        return `${player} cannot play ${context.card(cardId)} from the top of ${owner} using ${context.card(source)}, so it goes to ${destination}.`;
    }
    if (detail.startsWith("signature_added_to_hand:")) {
        const [, cardId, source] = detail.split(":");
        return `${player} adds ${context.card(cardId)} to their hand from ${context.card(source)}.`;
    }
    if (detail.startsWith("signature_already_supplied_this_turn:")) {
        const [, cardId, source] = detail.split(":");
        return `${player} already received ${context.card(cardId)} this turn, so ${context.card(source)} supplies no additional copy.`;
    }
    if (detail.startsWith("signature_already_in_hand:")) {
        const [, cardId, source] = detail.split(":");
        return `${player} already has ${context.card(cardId)} in hand, so ${context.card(source)} supplies no additional copy.`;
    }
    if (detail.startsWith("signature_discarded_from_hand:")) {
        return `${player} discards ${context.card(detail.split(":")[1])} from their hand at the end of their turn.`;
    }
    if (detail.startsWith("signature_granted:")) {
        const [, cardId, agentId] = detail.split(":");
        return `${context.card(agentId)} gains an additional Signature: ${context.card(cardId)} for the rest of the battle.`;
    }
    if (detail.startsWith("mission_progress:")) {
        const [, missionId, current] = detail.split(":");
        return `After drawing, ${context.card(missionId)} advances to Goal ${current}.`;
    }
    if (detail.startsWith("mission_complete:"))
        return `${player} completes ${context.card(detail.split(":")[1])}.`;
    if (detail.startsWith("mission_deleted:"))
        return `${context.card(detail.split(":")[1])} is deleted.`;
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
    if (detail.startsWith("jutsu_armed:"))
        return `${player} moves ${context.card(detail.split(":")[1])} to the Armed Jutsu zone.`;
    if (detail.startsWith("copies_created:")) {
        const [, cardId, amount, source] = detail.split(":");
        return `${player} creates ${amount} permanent printed copies of ${context.card(cardId)} from ${context.card(source)}.`;
    }
    if (detail.startsWith("module_attached:")) {
        const [, moduleId, hostId] = detail.split(":");
        return `${player} attaches ${context.card(moduleId)} to ${context.card(hostId)}.`;
    }
    if (detail.startsWith("module_redirected_damage:")) {
        const [, moduleId, hostId, targetId] = detail.split(":");
        return `${context.card(moduleId)} redirects damage from ${context.card(hostId)} to ${context.card(targetId)}.`;
    }
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
    // The following sync event carries the player-facing total, so do not show
    // the lower-level damage-to-Sync event as a duplicate line.
    if (detail.startsWith("damage:"))
        return "";
    if (detail.startsWith("agent_damaged:")) {
        const [, cardId, amount, integrity] = detail.split(":");
        return `${context.card(cardId)} takes ${amount} damage and has ${integrity} Integrity remaining.`;
    }
    if (detail.startsWith("agent_deleted:"))
        return `${player}'s ${context.card(detail.split(":")[1])} is deleted.`;
    if (detail.startsWith("agent_deletion_prevented:")) {
        const [, cardId, amount, current] = detail.split(":");
        return Number(amount) > 0 ? `${context.card(cardId)} gains ${amount} Integrity and remains at ${current}.` : `${context.card(cardId)} remains at ${current} Integrity.`;
    }
    if (detail.startsWith("module_deleted_with_agent:")) {
        return `${player}'s attached ${context.card(detail.split(":")[1])} is deleted with its Agent.`;
    }
    if (detail.startsWith("module_deleted_no_target:")) {
        return `${player}'s ${context.card(detail.split(":")[1])} is deleted because no Agent was available to attach it to.`;
    }
    if (detail.startsWith("module_deleted:")) {
        return `${player}'s ${context.card(detail.split(":")[1])} is deleted after redirecting damage.`;
    }
    if (detail.startsWith("daemon_deleted:"))
        return `${player}'s ${context.card(detail.split(":")[1])} is deleted.`;
    if (detail.startsWith("breach_modified:")) {
        const [, cardId, amount, current] = detail.split(":");
        return `${context.card(cardId)} gains ${amount} Breach. (Current Breach: ${current})`;
    }
    if (detail.startsWith("integrity_gained:")) {
        const [, cardId, amount, current] = detail.split(":");
        return `${context.card(cardId)} gains ${amount} Integrity. (Current Integrity: ${current})`;
    }
    if (detail === "pregame_end_turn_effect")
        return `${player}'s card effect has no turn to end before the battle begins.`;
    if (detail.startsWith("scan_deck:")) {
        const fields = detail.split(":"), looked = fields[1], found = fields[2];
        if (fields.length < 5)
            return `${player} looks at the top ${looked} cards and adds ${found} matching cards to their hand.`;
        const [, _, __, ids, source] = fields, cardIds = ids.split(","), target = cardIds.length === 1 ? `${context.card(cardIds[0])} ${plural(found, "card")}` : "matching cards";
        return `${player} uses ${context.card(source)} to look at the top ${looked} cards and adds ${found} ${target} to their hand.`;
    }
    if (detail.startsWith("cards_moved_from_deck:")) {
        const [, ids, source] = detail.split(":");
        const cardIds = ids ? ids.split(",").filter(Boolean) : [];
        if (!cardIds.length)
            return `${player} uses ${context.card(source)}, but no matching cards are moved from their ${deck(context, actor)} to their hand.`;
        const counts = [];
        for (const cardId of cardIds) {
            const existing = counts.find(entry => entry.id === cardId);
            if (existing)
                existing.count++;
            else
                counts.push({ id: cardId, count: 1 });
        }
        const names = counts.map(entry => entry.count > 1 ? `${entry.count} × ${context.card(entry.id)}` : context.card(entry.id));
        const listed = names.length === 1 ? names[0] : names.length === 2 ? names.join(" and ") : names.slice(0, -1).join(", ") + `, and ${names.at(-1)}`;
        return `${player} uses ${context.card(source)} to move ${listed} from their ${deck(context, actor)} to their hand.`;
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
        const [, trigger, cardId, recipient, subject] = fields;
        if (trigger === "own_agent_would_be_deleted" && subject)
            return `${player} plays ${context.card(cardId)} to protect ${context.card(subject)} from deletion.`;
        const response = trigger === "opponent_would_gain_flux" ? `${context.player(recipient)} gaining Flux` : "the triggering event";
        return `${player} ${subject === "armed" ? "resolves" : "plays"} ${context.card(cardId)} in response to ${response}.`;
    }
    if (detail.startsWith("flux_gain_prevented:")) {
        const [, amount, cardId, outcome] = detail.split(":"), ending = outcome === "deleted" ? " and is deleted." : outcome === "discarded" ? "." : ".";
        return `${player} would gain ${amount} Flux, but ${context.card(cardId)} prevents it${ending}`;
    }
    if (detail.startsWith("flux_gain_reduced:")) {
        const [, amount, sources = ""] = detail.split(":"), cards = sources.split(",").filter(Boolean).map((cardId) => context.card(cardId));
        return `${player} gains ${amount} less Flux due to ${cards.join(" and ")}.`;
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
        const sentence = source === "bonus" ? `gains ${Math.abs(value)} additional Flux from ${context.card(detail.split(":")[4])}.` : value > 0 && source && source !== "cost" ? `gains ${Math.abs(value)} Flux from ${context.card(source)}.` : `${value > 0 ? "gains " : "loses "}${Math.abs(value)} Flux.`;
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
