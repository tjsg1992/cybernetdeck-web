function error(code, message, path, start, end) {
    return { code, severity: "error", message, ...(path ? { path } : {}), ...(start === undefined ? {} : { start }), ...(end === undefined ? {} : { end }) };
}
function warning(code, message, path) {
    return { code, severity: "warning", message, ...(path ? { path } : {}) };
}
function normalizeText(text) {
    return text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, " ").trim();
}
const CORE_VALUES_SETUP_TEXT = "At the start of the battle, if you have any Core or Twin Core cards in your deck, you lose.";
function positiveNumber(value, path, diagnostics) {
    if (!Number.isInteger(value) || value <= 0) {
        diagnostics.push(error("invalid-amount", "Amounts must be positive integers.", path));
    }
}
function mechanicNode(mechanic) {
    return { type: "mechanic", mechanic };
}
function sequence(effects) {
    if (effects.length === 1)
        return effects[0];
    return { type: "sequence", effects };
}
function flattenEffects(node, output = []) {
    if (node.type === "sequence") {
        for (const effect of node.effects)
            flattenEffects(effect, output);
    }
    else {
        output.push(node);
    }
    return output;
}
function mechanicForNode(node, diagnostics, path) {
    if (node.type === "sequence") {
        return node.effects.flatMap((effect, index) => mechanicForNode(effect, diagnostics, `${path}.effects[${index}]`));
    }
    if (node.type === "mechanic") {
        return [node.mechanic];
    }
    if (node.type === "jutsu_preparation") {
        positiveNumber(node.maxPrepared, `${path}.maxPrepared`, diagnostics);
        return [];
    }
    if (node.type === "conditional") {
        positiveNumber(node.condition.threshold, `${path}.condition.threshold`, diagnostics);
        positiveNumber(node.effect.amount, `${path}.effect.amount`, diagnostics);
        return [{ type: "gain_victory_points_if_at_most", threshold: node.condition.threshold, amount: node.effect.amount }];
    }
    positiveNumber(node.effect.amount, `${path}.effect.amount`, diagnostics);
    return [{ type: "first_flux_gain_bonus", amount: node.effect.amount }];
}
function cardName(cardId, catalog) {
    return catalog[cardId]?.display_name ?? cardId;
}
function printMechanic(mechanic, spec, catalog) {
    switch (mechanic.type) {
        case "gain_flux": return `Gain ${mechanic.amount} Flux.`;
        case "remove_opponent_victory_points": return `Remove ${mechanic.amount} Flux from your opponent.`;
        case "gain_victory_points_if_at_most": return `If you have ${mechanic.threshold} or fewer Flux, gain ${mechanic.amount} Flux.`;
        case "first_flux_gain_bonus": return `The first time each turn you gain Flux, gain ${mechanic.amount} additional Flux.`;
        case "prevent_next_opponent_flux_gain": return `The next time your opponent would gain Flux, prevent that gain. Then, delete ${spec.display_name}.`;
        case "prevent_all_opponent_flux_gain": return "Whenever your opponent would gain Flux, prevent that Flux gain.";
        case "prevent_triggering_event": return spec.reaction_triggers?.includes("opponent_would_gain_flux") && spec.sync_cost !== undefined
            ? `When your opponent would gain Flux, you may pay ${spec.sync_cost} Sync and play this card. If you do, prevent that gain.`
            : "If you do, prevent that gain.";
        case "set_own_sync_and_draw_half_deck": return `Reduce your Sync to ${mechanic.sync}, draw half your remaining deck rounded down.`;
        case "remove_opponent_sync": return `Your opponent loses ${mechanic.amount} Sync.`;
        case "remove_own_sync": return `You lose ${mechanic.amount} Sync.`;
        case "restore_sync_when_zero_and_delete_self": return `When your Sync becomes 0, set your Sync to ${mechanic.sync}, then delete this card.`;
        case "scan_deck": return `Look at the top ${mechanic.count} cards of your deck and add any ${mechanic.card_ids.map((id) => cardName(id, catalog)).join(" or ")} cards to your hand. Then, put the remaining cards on the bottom in the same order.`;
        case "draw_two_if_hand_empty_otherwise_discard_random": return "If your hand is empty, draw two cards. Otherwise, discard a card at random.";
        case "discard_random_card": return mechanic.target === "opponent" ? "Your opponent discards a card at random." : "Discard a card at random.";
        case "gain_ki": return `Gain ${mechanic.amount} Ki.`;
        case "deal_damage": return `Deal ${mechanic.amount} damage.`;
        case "end_own_turn": return "End your turn.";
        case "queue_extra_turn": return spec.flux_cost !== undefined
            ? `Pay ${spec.flux_cost} Flux: At the end of your turn, take an extra turn.`
            : "At the end of your turn, take an extra turn.";
        case "draw_when_another_copy_played": return `The first time each turn another ${spec.display_name} enters play under your control, draw a card.`;
        case "destroy_random_opponent_daemon": return "If your opponent has a Daemon card in play, destroy a random Daemon card they control.";
        case "recover_random_discard": return `Shuffle ${mechanic.amount} random cards from your Discard into your deck.`;
        case "wipe_this_card": return "Then wipe this card.";
        case "add_cards_to_deck": return `Add ${mechanic.amount === 1 ? "a" : mechanic.amount} ${cardName(mechanic.card_id, catalog)} card${mechanic.amount === 1 ? "" : "s"} to your deck and ${mechanic.shuffle ? "shuffle" : "do not shuffle"}.`;
        case "gain_own_sync": return `Gain ${mechanic.amount} Sync.`;
        case "play_top_card_of_opponent_deck": return "Your opponent plays the top card of their deck.";
        case "opponent_sync_loss_bonus": return `Whenever a card you control causes your opponent to lose Sync, they lose an additional ${mechanic.amount} Sync.`;
        case "lose_own_agent_integrity_for_flux": return `All Agents you control lose ${mechanic.amount} Integrity. Gain 1 Flux for each Integrity lost this way.`;
        case "create_agents": return `Create ${mechanic.amount} ${mechanic.display_name} Agents, each with Integrity ${mechanic.integrity}.`;
        case "draw_cards": return `Draw ${mechanic.amount} cards.`;
        case "gain_integrity_all_agents": return `All Agents you control gain ${mechanic.amount} Integrity.`;
        case "modify_all_own_agents_breach": return `Agents you control gain Breach ${mechanic.amount}.`;
        case "destroy_all_agents_and_daemons": return "Delete every Agent and Daemon on both battlefields.";
        case "play_top_card_of_deck": return mechanic.target === "opponent"
            ? `Play the top card of your opponent's deck if able. If not, put it on the ${mechanic.fallback === "bottom" ? "bottom" : "discard pile"} of their deck.`
            : `Play the top card of your deck if able. If not, put it ${mechanic.fallback === "bottom" ? "on the bottom of your deck" : "into your discard pile"}.`;
        case "deal_damage_chain": return `Deal ${mechanic.amount} damage. If this deletes an Agent, deal damage again, reduced by ${mechanic.decrement}, and repeat until the next damage amount would be 0.`;
        case "deal_damage_by_own_agent_count": return "Deal 1 damage for each Agent you control.";
        case "first_daemon_play_gain_flux": return `The first time a Daemon is successfully played each turn, gain ${mechanic.amount} Flux.`;
        case "reduce_flux_gain": return `Whenever you would gain Flux, gain ${mechanic.amount} less Flux instead.`;
        case "collect_named_cards_from_deck": return "You can activate this card once per battle to move all Core and Twin Core cards from your deck to your hand, set your Sync to 1, and end your turn.";
        case "lose_at_setup_if_deck_contains": return CORE_VALUES_SETUP_TEXT;
        case "add_core_on_first_flux_gain": return "The first time each turn you gain Flux, add a Core to your deck and shuffle.";
        case "start_turn_damage_other_agents_gain_integrity": return `At the start of your turn, all other Agents on both battlefields lose ${mechanic.amount} Integrity. This Agent gains 1 Integrity for each Integrity lost this way.`;
        case "prevent_triggering_sync_loss": return spec.reaction_triggers?.includes("opponent_would_lose_sync") && spec.flux_cost !== undefined
            ? `When you would lose Sync during your opponent's turn, you may pay ${spec.flux_cost} Flux and play this card. If you do, prevent that Sync loss.`
            : "If you do, prevent that Sync loss.";
        case "create_copies_of_highest_breach_agent": return `Choose the Agent you control with the highest Breach. Create ${mechanic.amount} printed copies of it.`;
        case "prevent_triggering_agent_deletion": return `When an Agent you control would be deleted, you may resolve this card. If you do, prevent that deletion, set that Agent's Integrity to ${mechanic.minimum_integrity} if it is lower, then deal 1 damage to your opponent.`;
        case "module_attach_highest_breach_protect": return "When this enters play, attach it to an Agent you specify. The first time that Agent would be chosen to take damage, if another Agent can take that damage, ignore the attached Agent, then delete this Module.";
        default: {
            const exhaustive = mechanic;
            return exhaustive;
        }
    }
}
function printEffectNode(node, spec, catalog) {
    if (node.type === "sequence") {
        return node.effects.map((effect) => printEffectNode(effect, spec, catalog)).join(" ");
    }
    if (node.type === "mechanic") {
        return printMechanic(node.mechanic, spec, catalog);
    }
    if (node.type === "jutsu_preparation") {
        return "You may play a Jutsu as a Prepared Jutsu by paying its non-Sign costs and putting it beneath this card instead of resolving it. You can't have more than one Prepared Jutsu beneath this card at a time.";
    }
    if (node.type === "conditional") {
        return `If you have ${node.condition.threshold} or fewer Flux, gain ${node.effect.amount} Flux.`;
    }
    return `The first time each turn you gain Flux, gain ${node.effect.amount} additional Flux.`;
}
export function printEffect(node, spec, catalog) {
    if (node === spec.effects && spec.canonical_effect !== undefined)
        return spec.canonical_effect;
    return printEffectNode(node, spec, catalog);
}
function splitClauses(text) {
    let start = 0;
    const normalized = normalizeText(text);
    const clauses = [];
    const boundary = /\.\s+(?=(?:Then\b|Otherwise\b|[A-Z]))/g;
    let match;
    while ((match = boundary.exec(normalized))) {
        clauses.push(normalized.slice(start, match.index + 1).trim());
        start = match.index + match[0].length - 1;
    }
    clauses.push(normalized.slice(start).trim());
    return clauses.filter(Boolean);
}
function parseClause(clause, offset, catalog) {
    clause = clause.replace(/^Then,?\s+/i, "");
    const diagnostics = [];
    let match;
    match = clause.match(/^Gain (\d+) Flux\.$/i);
    if (match)
        return { value: mechanicNode({ type: "gain_flux", amount: Number(match[1]) }), diagnostics };
    match = clause.match(/^Remove (\d+) Flux from your opponent\.$/i);
    if (match)
        return { value: mechanicNode({ type: "remove_opponent_victory_points", amount: Number(match[1]) }), diagnostics };
    match = clause.match(/^If you have (\d+) or fewer Flux, gain (\d+) Flux\.$/i);
    if (match)
        return { value: { type: "conditional", condition: { type: "own_flux_at_most", threshold: Number(match[1]) }, effect: { type: "gain_flux", amount: Number(match[2]) } }, diagnostics };
    match = clause.match(/^The first time each turn you gain Flux, gain (\d+) additional Flux\.$/i);
    if (match)
        return { value: { type: "triggered", trigger: { type: "first_flux_gain_each_turn" }, effect: { type: "gain_flux", amount: Number(match[1]) } }, diagnostics };
    if (/^The next time your opponent would gain Flux, prevent that gain\.(?: Then, delete (?:this card|[\w ]+)\.)?$/i.test(clause)) {
        return { value: mechanicNode({ type: "prevent_next_opponent_flux_gain" }), diagnostics };
    }
    match = clause.match(/^Pay (\d+) Flux: At the end of your turn, take an extra turn\.$/i);
    if (match)
        return { value: mechanicNode({ type: "queue_extra_turn" }), diagnostics };
    if (/^When your opponent would gain Flux, you may pay \d+ Sync and play this card\. If you do, prevent that gain\.$/i.test(clause)) {
        return { value: mechanicNode({ type: "prevent_triggering_event" }), diagnostics };
    }
    match = clause.match(/^Reduce your Sync to (\d+), draw half your remaining deck rounded down\.$/i);
    if (match)
        return { value: mechanicNode({ type: "set_own_sync_and_draw_half_deck", sync: Number(match[1]) }), diagnostics };
    match = clause.match(/^Your opponent loses (\d+) Sync\.$/i);
    if (match)
        return { value: mechanicNode({ type: "remove_opponent_sync", amount: Number(match[1]) }), diagnostics };
    match = clause.match(/^Reduce your opponent's Sync by (\d+)\.$/i);
    if (match)
        return { value: mechanicNode({ type: "remove_opponent_sync", amount: Number(match[1]) }), diagnostics };
    match = clause.match(/^You lose (\d+) Sync\.$/i);
    if (match)
        return { value: mechanicNode({ type: "remove_own_sync", amount: Number(match[1]) }), diagnostics };
    match = clause.match(/^When your Sync becomes 0, set your Sync to (\d+), then delete this card\.$/i);
    if (match)
        return { value: mechanicNode({ type: "restore_sync_when_zero_and_delete_self", sync: Number(match[1]) }), diagnostics };
    if (/^If your hand is empty, draw two cards\. Otherwise, discard a card at random\.$/i.test(clause)) {
        return { value: mechanicNode({ type: "draw_two_if_hand_empty_otherwise_discard_random" }), diagnostics };
    }
    if (/^Discard a card at random\.$/i.test(clause))
        return { value: mechanicNode({ type: "discard_random_card", target: "self" }), diagnostics };
    if (/^Your opponent discards a card at random\.$/i.test(clause))
        return { value: mechanicNode({ type: "discard_random_card", target: "opponent" }), diagnostics };
    match = clause.match(/^Gain (\d+) Ki\.$/i);
    if (match)
        return { value: mechanicNode({ type: "gain_ki", amount: Number(match[1]) }), diagnostics };
    match = clause.match(/^Deal (\d+) damage(?: to your opponent)?\.$/i);
    if (match)
        return { value: mechanicNode({ type: "deal_damage", amount: Number(match[1]) }), diagnostics };
    if (/^End your turn\.$/i.test(clause))
        return { value: mechanicNode({ type: "end_own_turn" }), diagnostics };
    if (/^At the end of your turn, take an extra turn\.$/i.test(clause))
        return { value: mechanicNode({ type: "queue_extra_turn" }), diagnostics };
    match = clause.match(/^The first time each turn another (.+) enters play under your control, draw a card\.$/i);
    if (match)
        return { value: mechanicNode({ type: "draw_when_another_copy_played" }), diagnostics };
    if (/^If your opponent has a Daemon card in play, destroy a random Daemon card they control\.$/i.test(clause)) {
        return { value: mechanicNode({ type: "destroy_random_opponent_daemon" }), diagnostics };
    }
    match = clause.match(/^Shuffle (a|one|two|\d+) random cards from your Discard into your deck\.$/i);
    if (match) {
        const amount = match[1].toLowerCase() === "a" || match[1].toLowerCase() === "one" ? 1 : match[1].toLowerCase() === "two" ? 2 : Number(match[1]);
        return { value: mechanicNode({ type: "recover_random_discard", amount }), diagnostics };
    }
    if (/^(?:Then )?wipe this card\.$/i.test(clause))
        return { value: mechanicNode({ type: "wipe_this_card" }), diagnostics };
    match = clause.match(/^Gain (\d+) Sync\.$/i);
    if (match)
        return { value: mechanicNode({ type: "gain_own_sync", amount: Number(match[1]) }), diagnostics };
    if (/^Your opponent plays the top card of their deck\.$/i.test(clause)) {
        return { value: mechanicNode({ type: "play_top_card_of_opponent_deck" }), diagnostics };
    }
    match = clause.match(/^Whenever a card you control causes your opponent to lose Sync, they lose an additional (\d+) Sync\.$/i);
    if (match)
        return { value: mechanicNode({ type: "opponent_sync_loss_bonus", amount: Number(match[1]) }), diagnostics };
    match = clause.match(/^Create (\d+) ([^,]+) Agents?, each with Integrity (\d+)\.$/i);
    if (match)
        return { value: mechanicNode({ type: "create_agents", amount: Number(match[1]), display_name: match[2].trim(), integrity: Number(match[3]) }), diagnostics };
    match = clause.match(/^Draw (\d+) cards?\.$/i);
    if (match)
        return { value: mechanicNode({ type: "draw_cards", amount: Number(match[1]) }), diagnostics };
    match = clause.match(/^All Agents you control gain (\d+) Integrity\.$/i);
    if (match)
        return { value: mechanicNode({ type: "gain_integrity_all_agents", amount: Number(match[1]) }), diagnostics };
    match = clause.match(/^Agents you control gain Breach (\d+)\.$/i);
    if (match)
        return { value: mechanicNode({ type: "modify_all_own_agents_breach", amount: Number(match[1]) }), diagnostics };
    if (/^(?:Destroy|Delete) every Agent and Daemon on both battlefields\.$/i.test(clause))
        return { value: mechanicNode({ type: "destroy_all_agents_and_daemons" }), diagnostics };
    if (/^Play the top card of your opponent's deck if able\.$/i.test(clause))
        return { value: mechanicNode({ type: "play_top_card_of_deck", target: "opponent", fallback: "bottom" }), diagnostics };
    if (/^Play the top card of your deck if able\.$/i.test(clause))
        return { value: mechanicNode({ type: "play_top_card_of_deck", target: "self", fallback: "discard" }), diagnostics };
    match = clause.match(/^Deal (\d+) damage\. If this deletes an Agent, deal damage again, reduced by (\d+), and repeat until the next damage amount would be 0\.$/i);
    if (match)
        return { value: mechanicNode({ type: "deal_damage_chain", amount: Number(match[1]), decrement: Number(match[2]) }), diagnostics };
    if (/^Deal 1 damage for each Agent you control\.$/i.test(clause))
        return { value: mechanicNode({ type: "deal_damage_by_own_agent_count" }), diagnostics };
    match = clause.match(/^The first time a Daemon is successfully played each turn, gain (\d+) Flux\.$/i);
    if (match)
        return { value: mechanicNode({ type: "first_daemon_play_gain_flux", amount: Number(match[1]) }), diagnostics };
    match = clause.match(/^Whenever you would gain Flux, gain (\d+) less Flux instead\.$/i);
    if (match)
        return { value: mechanicNode({ type: "reduce_flux_gain", amount: Number(match[1]) }), diagnostics };
    if (/^(?:You can activate this card once per battle to move all Core and Twin Core cards from your deck to your hand, set your Sync to 1, and end your turn\.|Once per battle, move all Core and Twin Core cards from your deck to your hand in deck order, set your Sync to 1, and end your turn\.)$/i.test(clause))
        return { value: mechanicNode({ type: "collect_named_cards_from_deck", card_ids: ["victory_point_1", "victory_point_2"], end_turn: true }), diagnostics };
    if (/^(?:At the start of the battle, if you have any Core or Twin Core cards in your deck, you lose\.|At setup, if your deck contains a Core or Twin Core, you lose the battle\.)$/i.test(clause))
        return { value: mechanicNode({ type: "lose_at_setup_if_deck_contains", card_ids: ["victory_point_1", "victory_point_2"] }), diagnostics };
    if (/^The first time each turn you gain Flux, add a Core to your deck and shuffle\.$/i.test(clause))
        return { value: mechanicNode({ type: "add_core_on_first_flux_gain" }), diagnostics };
    match = clause.match(/^At the start of your turn, all other Agents on both battlefields lose (\d+) Integrity\. This Agent gains 1 Integrity for each Integrity lost this way\.$/i);
    if (match)
        return { value: mechanicNode({ type: "start_turn_damage_other_agents_gain_integrity", amount: Number(match[1]) }), diagnostics };
    if (/^If you do, prevent that gain\.$/i.test(clause)) {
        return { value: mechanicNode({ type: "prevent_triggering_event" }), diagnostics };
    }
    if (/^When you would lose Sync during your opponent's turn, you may pay (\d+) Flux and play this card\. If you do, prevent that Sync loss\.$/i.test(clause)) {
        return { value: mechanicNode({ type: "prevent_triggering_sync_loss" }), diagnostics };
    }
    if (/^If you do, prevent that Sync loss\.$/i.test(clause)) {
        return { value: mechanicNode({ type: "prevent_triggering_sync_loss" }), diagnostics };
    }
    match = clause.match(/^Add (a|\d+|one|two) (.+?) cards? to your deck and shuffle\.$/i);
    if (match) {
        const amount = match[1].toLowerCase() === "a" || match[1].toLowerCase() === "one" ? 1 : match[1].toLowerCase() === "two" ? 2 : Number(match[1]);
        const card = Object.values(catalog).find((candidate) => candidate.display_name.toLowerCase() === match[2].toLowerCase());
        if (!card)
            return { diagnostics: [error("unknown-card-reference", `The add-to-deck text names a card that is absent from the supplied catalog: ${match[2]}.`)] };
        return { value: mechanicNode({ type: "add_cards_to_deck", card_id: card.card_id, amount, shuffle: true }), diagnostics };
    }
    if (/^Your opponent plays the top card of their deck\.$/i.test(clause)) {
        return { value: mechanicNode({ type: "play_top_card_of_opponent_deck" }), diagnostics };
    }
    diagnostics.push(error("unsupported-wording", `The controlled rules grammar does not recognize: ${clause}`, undefined, offset, offset + clause.length));
    return { diagnostics };
}
export function parseEffectText(text, catalog = {}) {
    const normalized = normalizeText(text);
    if (!normalized)
        return { value: { type: "sequence", effects: [] }, diagnostics: [] };
    if (/^When this enters play, gain \d+ Flux\./i.test(normalized)) {
        const gain = normalized.match(/^When this enters play, gain (\d+) Flux\./i);
        return { value: mechanicNode({ type: "gain_flux", amount: Number(gain?.[1] ?? 1) }), diagnostics: [] };
    }
    if (/^Choose the Naruto Agent you control with the highest Breach, breaking ties by oldest\. Create \d+ printed copies of it\./i.test(normalized)) {
        const amount = normalized.match(/Create (\d+) printed copies/i);
        return { value: mechanicNode({ type: "create_copies_of_highest_breach_agent", amount: Number(amount?.[1] ?? 1), eligible_card_ids: ["naruto_knuckleheaded_ninja"] }), diagnostics: [] };
    }
    if (/^When this enters play, attach it to an Agent you specify\./i.test(normalized)) {
        return { value: mechanicNode({ type: "module_attach_highest_breach_protect" }), diagnostics: [] };
    }
    // Substitution's leading Sync instruction is its play cost. It remains in
    // the printed effect for the card face, but is not a resolution mechanic.
    if (/^You lose 2 Sync\. When an Agent you control would be deleted, you may resolve this card\./i.test(normalized)) {
        return { value: sequence([
                mechanicNode({ type: "prevent_triggering_agent_deletion", minimum_integrity: 1 }),
                mechanicNode({ type: "deal_damage", amount: 1 }),
            ]), diagnostics: [] };
    }
    if (/^Whenever your opponent would gain Flux, prevent that Flux gain\.$/i.test(normalized)) {
        return { value: mechanicNode({ type: "prevent_all_opponent_flux_gain" }), diagnostics: [] };
    }
    const setupPrefixed = normalized.match(/^At the start of the battle, if you have any Core or Twin Core cards in your deck, you lose\. (.+)$/i);
    if (setupPrefixed)
        return parseEffectText(setupPrefixed[1], catalog);
    const forcedPlay = normalized.match(/^Play the top card of your opponent's deck if able\. If not, put it on the bottom of their deck\.$/i);
    if (forcedPlay)
        return { value: mechanicNode({ type: "play_top_card_of_deck", target: "opponent", fallback: "bottom" }), diagnostics: [] };
    const selfForcedPlayBottom = normalized.match(/^Play the top card of your deck if able\. If not, put it on the bottom of your deck\.$/i);
    if (selfForcedPlayBottom)
        return { value: mechanicNode({ type: "play_top_card_of_deck", target: "self", fallback: "bottom" }), diagnostics: [] };
    const selfForcedPlay = normalized.match(/^Play the top card of your deck if able\. If not, put it into your discard pile\. Lose 1 Sync\.$/i);
    if (selfForcedPlay)
        return { value: sequence([
                mechanicNode({ type: "play_top_card_of_deck", target: "self", fallback: "discard" }),
                mechanicNode({ type: "remove_own_sync", amount: 1 }),
            ]), diagnostics: [] };
    if (/^When you would lose Sync during your opponent's turn, you may pay \d+ Flux and play this card\. If you do, prevent that Sync loss\.$/i.test(normalized)) {
        return { value: mechanicNode({ type: "prevent_triggering_sync_loss" }), diagnostics: [] };
    }
    const chainDamage = normalized.match(/^(?:Pay 1 Ki\. )?Deal (\d+) damage\. If this deletes an Agent, deal damage again, reduced by (\d+), and repeat until the next damage amount would be 0\.$/i);
    if (chainDamage)
        return { value: mechanicNode({ type: "deal_damage_chain", amount: Number(chainDamage[1]), decrement: Number(chainDamage[2]) }), diagnostics: [] };
    if (/^Draw 3 cards, then end your turn\.$/i.test(normalized))
        return { value: sequence([
                mechanicNode({ type: "draw_cards", amount: 3 }), mechanicNode({ type: "end_own_turn" }),
            ]), diagnostics: [] };
    if (/^All Agents you control gain Breach 1\.$/i.test(normalized))
        return { value: mechanicNode({ type: "modify_all_own_agents_breach", amount: 1 }), diagnostics: [] };
    if (/^(?:Destroy|Delete) every Agent and Daemon on both battlefields\.$/i.test(normalized))
        return { value: mechanicNode({ type: "destroy_all_agents_and_daemons" }), diagnostics: [] };
    if (/^All Agents you control gain 1 Integrity\.$/i.test(normalized))
        return { value: mechanicNode({ type: "gain_integrity_all_agents", amount: 1 }), diagnostics: [] };
    if (/^Deal 1 damage for each Agent you control\.$/i.test(normalized))
        return { value: mechanicNode({ type: "deal_damage_by_own_agent_count" }), diagnostics: [] };
    if (/^The first time a Daemon is successfully played each turn, gain 1 Flux\.$/i.test(normalized))
        return { value: mechanicNode({ type: "first_daemon_play_gain_flux", amount: 1 }), diagnostics: [] };
    if (/^Whenever you would gain Flux, gain 1 less Flux instead\.$/i.test(normalized))
        return { value: mechanicNode({ type: "reduce_flux_gain", amount: 1 }), diagnostics: [] };
    if (/^(?:You can activate this card once per battle to move all Core and Twin Core cards from your deck to your hand, set your Sync to 1, and end your turn\.|Once per battle, move all Core and Twin Core cards from your deck to your hand in deck order, set your Sync to 1, and end your turn\.)$/i.test(normalized))
        return { value: mechanicNode({ type: "collect_named_cards_from_deck", card_ids: ["victory_point_1", "victory_point_2"], end_turn: true }), diagnostics: [] };
    if (/^The first time each turn you gain Flux, add a Core to your deck and shuffle\.$/i.test(normalized))
        return { value: mechanicNode({ type: "add_core_on_first_flux_gain" }), diagnostics: [] };
    if (/^At the start of your turn, all other Agents on both battlefields lose 1 Integrity\. This Agent gains 1 Integrity for each Integrity lost this way\.$/i.test(normalized))
        return { value: mechanicNode({ type: "start_turn_damage_other_agents_gain_integrity", amount: 1 }), diagnostics: [] };
    if (/^At the start of your turn, all other Agents on both battlefields lose 1 Integrity\. This Agent gains 1 Integrity for each Integrity lost this way\. Whenever you would gain Flux, gain 1 less Flux instead\.$/i.test(normalized))
        return { value: sequence([
                mechanicNode({ type: "start_turn_damage_other_agents_gain_integrity", amount: 1 }),
                mechanicNode({ type: "reduce_flux_gain", amount: 1 }),
            ]), diagnostics: [] };
    const integrityLoss = normalized.match(/^All Agents you control lose (\d+) Integrity\. Gain 1 Flux for each Integrity lost this way\.$/i);
    if (integrityLoss) {
        return { value: mechanicNode({ type: "lose_own_agent_integrity_for_flux", amount: Number(integrityLoss[1]) }), diagnostics: [] };
    }
    if (/^If your hand is empty, draw two cards\. Otherwise, discard a card at random\.$/i.test(normalized)) {
        return { value: mechanicNode({ type: "draw_two_if_hand_empty_otherwise_discard_random" }), diagnostics: [] };
    }
    const combinedPrevent = normalized.match(/^The next time your opponent would gain Flux, prevent that gain\. Then, delete (?:this card|([\w ]+))\.$/i);
    if (combinedPrevent) {
        return { value: mechanicNode({ type: "prevent_next_opponent_flux_gain" }), diagnostics: [] };
    }
    if (/^Pay \d+ Flux: At the end of your turn, take an extra turn\.$/i.test(normalized)) {
        return { value: mechanicNode({ type: "queue_extra_turn" }), diagnostics: [] };
    }
    if (/^When your opponent would gain Flux, you may pay \d+ Sync and play this card\. If you do, prevent that gain\.$/i.test(normalized)) {
        return { value: mechanicNode({ type: "prevent_triggering_event" }), diagnostics: [] };
    }
    if (/^You may play a Jutsu as a Prepared Jutsu by paying its non-Sign costs and putting it beneath this card instead of resolving it\. You can't have more than one Prepared Jutsu beneath this card at a time\.$/i.test(normalized)) {
        return { value: { type: "jutsu_preparation", maxPrepared: 1 }, diagnostics: [] };
    }
    if (/^Activate this card only if you haven't played a card this turn\. Gain \d+ Ki\. End your turn\.$/i.test(normalized)) {
        const gain = normalized.match(/Gain (\d+) Ki/i);
        return { value: sequence([
                mechanicNode({ type: "gain_ki", amount: Number(gain?.[1] ?? 1) }),
                mechanicNode({ type: "end_own_turn" }),
            ]), diagnostics: [] };
    }
    const cursedSeal = normalized.match(/^Reduce your Sync to (\d+), draw half your remaining deck rounded down, then end your turn\.$/i);
    if (cursedSeal) {
        return { value: sequence([
                mechanicNode({ type: "set_own_sync_and_draw_half_deck", sync: Number(cursedSeal[1]) }),
                mechanicNode({ type: "end_own_turn" }),
            ]), diagnostics: [] };
    }
    const scrappy = normalized.match(/^Play this card only if you have (\d+) or more Ki\. When it enters play, it deals (\d+) damage\.$/i);
    if (scrappy)
        return { value: mechanicNode({ type: "deal_damage", amount: Number(scrappy[2]) }), diagnostics: [] };
    const combinedSync = normalized.match(/^Lose (\d+) Sync\. Whenever a card you control causes your opponent to lose Sync, they lose an additional (\d+) Sync\.$/i);
    if (combinedSync) {
        return { value: sequence([
                mechanicNode({ type: "remove_own_sync", amount: Number(combinedSync[1]) }),
                mechanicNode({ type: "opponent_sync_loss_bonus", amount: Number(combinedSync[2]) }),
            ]), diagnostics: [] };
    }
    const combinedScan = normalized.match(/^Look at the top (\d+) cards of your deck and add any (.+?) cards to your hand\. Then, put the remaining cards on the bottom in the same order\.$/i);
    if (combinedScan) {
        const names = combinedScan[2].split(/\s+or\s+/i).map((name) => name.trim());
        const cardIds = names.map((name) => Object.values(catalog).find((card) => card.display_name.toLowerCase() === name.toLowerCase())?.card_id);
        const missingIndex = cardIds.findIndex((id) => !id);
        if (missingIndex >= 0)
            return { diagnostics: [error("unknown-card-reference", `The scan text names a card that is absent from the supplied catalog: ${names[missingIndex]}.`)] };
        return { value: mechanicNode({ type: "scan_deck", count: Number(combinedScan[1]), card_ids: cardIds }), diagnostics: [] };
    }
    const clauses = splitClauses(normalized);
    const effects = [];
    const diagnostics = [];
    let searchOffset = 0;
    for (const clause of clauses) {
        const result = parseClause(clause, searchOffset, catalog);
        diagnostics.push(...result.diagnostics);
        if (result.value)
            effects.push(result.value);
        searchOffset += clause.length + 1;
    }
    return diagnostics.some((item) => item.severity === "error")
        ? { diagnostics }
        : { value: sequence(effects), diagnostics };
}
function validateMechanic(mechanic, spec, catalog, path) {
    const diagnostics = [];
    const amountFields = ["amount", "count", "sync", "threshold", "integrity"];
    for (const field of amountFields) {
        const value = mechanic[field];
        if (typeof value === "number")
            positiveNumber(value, `${path}.${field}`, diagnostics);
    }
    if (mechanic.type === "scan_deck" || mechanic.type === "add_cards_to_deck") {
        const ids = mechanic.type === "scan_deck" ? mechanic.card_ids : [mechanic.card_id];
        for (const id of ids)
            if (!catalog[id])
                diagnostics.push(error("unknown-card-reference", `Referenced card ${id} is not present in the supplied catalog.`, `${path}.card_id`));
    }
    if (mechanic.type === "create_agents" && !mechanic.display_name.trim()) {
        diagnostics.push(error("missing-agent-name", "Generated Agents require a display name.", `${path}.display_name`));
    }
    if (mechanic.type === "discard_random_card" && !["self", "opponent"].includes(mechanic.target)) {
        diagnostics.push(error("invalid-discard-target", "Random discard target must be self or opponent.", `${path}.target`));
    }
    if (mechanic.type === "add_cards_to_deck" && mechanic.amount < 1) {
        diagnostics.push(error("invalid-generated-count", "Generated card count must be positive.", `${path}.amount`));
    }
    if (mechanic.type === "draw_when_another_copy_played" && !spec.display_name.trim()) {
        diagnostics.push(error("missing-card-name", "Triggered copy effects require a card display name.", "display_name"));
    }
    return diagnostics;
}
function validateNode(node, spec, catalog, path) {
    if (node.type === "sequence") {
        if (!node.effects.length)
            return [];
        return node.effects.flatMap((effect, index) => validateNode(effect, spec, catalog, `${path}.effects[${index}]`));
    }
    if (node.type === "mechanic")
        return validateMechanic(node.mechanic, spec, catalog, path);
    if (node.type === "conditional") {
        const diagnostics = [];
        positiveNumber(node.condition.threshold, `${path}.condition.threshold`, diagnostics);
        positiveNumber(node.effect.amount, `${path}.effect.amount`, diagnostics);
        return diagnostics;
    }
    if (node.type === "jutsu_preparation") {
        const diagnostics = [];
        positiveNumber(node.maxPrepared, `${path}.maxPrepared`, diagnostics);
        return diagnostics;
    }
    const diagnostics = [];
    positiveNumber(node.effect.amount, `${path}.effect.amount`, diagnostics);
    return diagnostics;
}
export function validateCardSpec(spec, catalog) {
    const diagnostics = validateNode(spec.effects, spec, catalog, "effects");
    if (!/^[a-z0-9_]+$/.test(spec.card_id))
        diagnostics.push(error("invalid-card-id", "Card IDs must use lowercase letters, numbers, and underscores.", "card_id"));
    if (!spec.display_name.trim())
        diagnostics.push(error("missing-display-name", "Cards require a display name.", "display_name"));
    const numericFields = ["flux_cost", "bandwidth_cost", "sync_cost", "ki_cost", "minimum_ki", "uplink_requirement", "integrity", "breach"];
    for (const field of numericFields) {
        const value = spec[field];
        if (value !== undefined)
            positiveNumber(value, field, diagnostics);
    }
    for (const id of spec.adds_card_ids ?? []) {
        if (!catalog[id])
            diagnostics.push(error("unknown-card-reference", `Referenced card ${id} is not present in the supplied catalog.`, "adds_card_ids"));
    }
    if (spec.draft_effect !== undefined) {
        const printed = printEffect(spec.effects, spec, catalog);
        if (normalizeText(spec.draft_effect) !== normalizeText(printed)) {
            diagnostics.push(warning("wording-drift", `Draft wording differs from canonical wording: ${printed}`, "draft_effect"));
        }
    }
    if (spec.canonical_effect !== undefined) {
        const parsed = parseEffectText(spec.canonical_effect, catalog);
        if (parsed.diagnostics.some((item) => item.severity === "error") || !parsed.value) {
            diagnostics.push(error("invalid-canonical-wording", `Canonical wording is not supported by the controlled grammar: ${formatDiagnostics(parsed.diagnostics)}`, "canonical_effect"));
        }
        else {
            const expectedDiagnostics = [];
            const actualDiagnostics = [];
            const expected = mechanicForNode(spec.effects, expectedDiagnostics, "effects");
            const actual = mechanicForNode(parsed.value, actualDiagnostics, "canonical_effect");
            if (expectedDiagnostics.some((item) => item.severity === "error") || actualDiagnostics.some((item) => item.severity === "error") || JSON.stringify(expected) !== JSON.stringify(actual)) {
                diagnostics.push(error("canonical-mechanics-mismatch", "Canonical wording does not compile to the specification's declared mechanic sequence.", "canonical_effect"));
            }
        }
    }
    return diagnostics;
}
export function compileCardSpec(spec, catalog) {
    const diagnostics = validateCardSpec(spec, catalog);
    if (diagnostics.some((item) => item.severity === "error"))
        return { diagnostics };
    const mechanics = mechanicForNode(spec.effects, diagnostics, "effects");
    if (diagnostics.some((item) => item.severity === "error"))
        return { diagnostics };
    const { effects: _effects, draft_effect: _draft, canonical_effect: _canonical, traceability: _traceability, ...metadata } = spec;
    const definition = {
        ...metadata,
        effect: printEffect(spec.effects, spec, catalog),
        ...(mechanics.length ? { mechanics } : {}),
    };
    return { value: definition, diagnostics };
}
export function mechanicTypes(node) {
    const diagnostics = [];
    return [...new Set(mechanicForNode(node, diagnostics, "effects").map((mechanic) => mechanic.type))];
}
export function traceabilityDiagnostics(spec, available, strict = false) {
    const diagnostics = [];
    const trace = spec.traceability;
    if (!trace) {
        diagnostics.push(error("missing-traceability", "Compiler-owned cards require traceability metadata.", "traceability"));
        return diagnostics;
    }
    for (const mechanic of mechanicTypes(spec.effects)) {
        if (!available.mechanicTypes.has(mechanic))
            diagnostics.push(error("unknown-mechanic", `Mechanic ${mechanic} is not registered in the conformance domain.`, "effects"));
    }
    for (const ruleId of trace.ruleIds ?? [])
        if (!available.ruleIds.has(ruleId))
            diagnostics.push(error("unknown-rule", `Unknown Compendium rule ${ruleId}.`, "traceability.ruleIds"));
    for (const claimId of trace.claimIds ?? [])
        if (!available.claimIds.has(claimId))
            diagnostics.push(error("unknown-claim", `Unknown conformance claim ${claimId}.`, "traceability.claimIds"));
    for (const ownerId of trace.ownerIds ?? [])
        if (!available.ownerIds.has(ownerId))
            diagnostics.push(error("unknown-owner", `Unknown implementation owner ${ownerId}.`, "traceability.ownerIds"));
    for (const evidenceId of trace.evidenceIds ?? [])
        if (!available.evidenceIds.has(evidenceId))
            diagnostics.push(error("unknown-evidence", `Unknown evidence ${evidenceId}.`, "traceability.evidenceIds"));
    if (strict && !(trace.evidenceIds ?? []).length)
        diagnostics.push(error("missing-evidence", "Strict traceability requires executable evidence.", "traceability.evidenceIds"));
    return diagnostics;
}
export function cardSpecFromDefinition(definition, catalog, traceability) {
    const parsed = parseEffectText(definition.effect, catalog);
    if (!parsed.value || parsed.diagnostics.some((item) => item.severity === "error")) {
        throw new Error(`Cannot convert ${definition.card_id} to a CardSpec: ${parsed.diagnostics.map((item) => item.message).join("; ")}`);
    }
    const { effect: _effect, mechanics: _mechanics, ...metadata } = definition;
    return { ...metadata, effects: parsed.value, traceability, draft_effect: definition.effect };
}
export function auditCardCatalog(catalog) {
    const supported = [];
    const unsupported = [];
    for (const definition of Object.values(catalog)) {
        const parsed = parseEffectText(definition.effect, catalog);
        if (parsed.diagnostics.some((item) => item.severity === "error")) {
            unsupported.push({ cardId: definition.card_id, diagnostics: parsed.diagnostics });
        }
        else {
            supported.push(definition.card_id);
        }
    }
    return { supported, unsupported };
}
export function metadataFromDefinition(definition) {
    const { card_id, display_name, card_kind, immutable, activation, activation_limit, supports_jutsu_preparation, jutsu, signs, integrity, breach, signature, signature_card_id, uplink_requirement, minimum_ki, ki_cost, requires_no_prior_play, flux_cost, bandwidth_cost, sync_cost, adds_card_ids, reaction_triggers, module, programmed_target, } = definition;
    return {
        card_id, display_name, card_kind, immutable, activation, activation_limit, supports_jutsu_preparation,
        jutsu, signs, integrity, breach, signature, signature_card_id, uplink_requirement,
        minimum_ki, ki_cost, requires_no_prior_play, flux_cost, bandwidth_cost, sync_cost,
        adds_card_ids, reaction_triggers, module, programmed_target,
    };
}
export function formatDiagnostics(diagnostics) {
    return diagnostics.map((item) => `${item.severity.toUpperCase()} ${item.code}${item.path ? ` (${item.path})` : ""}: ${item.message}`).join("\n");
}
