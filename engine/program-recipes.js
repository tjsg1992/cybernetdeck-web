export const PROGRAM_RULE_LIMIT = 10;
export function isDirectRuleForCard(rule, cardId) {
    return (rule.action_type === "play_named_card" || rule.action_type === "activate_immutable_card")
        && rule.action_card_id === cardId;
}
function cloneRule(rule) {
    return structuredClone(rule);
}
export function extractDirectRules(rules, cardId) {
    return rules.filter((rule) => isDirectRuleForCard(rule, cardId)).map(cloneRule);
}
export function referencedCardIds(rule) {
    const ids = [rule.condition_card_id, rule.action_card_id];
    if (Array.isArray(rule.action_card_ids))
        ids.push(...rule.action_card_ids);
    if (Array.isArray(rule.action_card_all_ids))
        ids.push(...rule.action_card_all_ids);
    return [...new Set(ids.filter((id) => typeof id === "string" && Boolean(id)))];
}
export function recipeIsCompatible(recipe, availableCardIds) {
    const rules = Array.isArray(recipe.rules) ? recipe.rules : [];
    const reactionConditions = Array.isArray(recipe.reaction_conditions) ? recipe.reaction_conditions : [];
    if (!availableCardIds.has(recipe.card_id) || (!rules.length && !reactionConditions.length))
        return false;
    return rules.every((raw) => {
        const rule = raw;
        return isDirectRuleForCard(rule, recipe.card_id)
            && rule.action_type !== "play_combo"
            && referencedCardIds(rule).every((id) => availableCardIds.has(id));
    }) && reactionConditions.every((condition) => {
        const trigger = condition;
        return ["opponent_would_gain_flux", "opponent_would_lose_sync", "own_agent_would_be_deleted"].includes(String(trigger.trigger_type))
            && ["<", "<=", "=", ">=", ">"].includes(String(trigger.comparison_operator))
            && Number.isSafeInteger(trigger.quantity_threshold)
            && Number(trigger.quantity_threshold) >= 0
            && Number(trigger.quantity_threshold) <= 65535;
    });
}
export function selectedRecipesByCard(recipes, preferences) {
    const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
    const selected = new Map();
    for (const preference of preferences) {
        const recipe = byId.get(preference.recipe_id);
        if (recipe && recipe.card_id === preference.card_id)
            selected.set(preference.card_id, recipe);
    }
    return selected;
}
export function applyProgramRecipe(program, cardId, recipe, availableCardIds) {
    if (program.some((rule) => isDirectRuleForCard(rule, cardId))) {
        return { program: program.map(cloneRule), applied: false, reason: "already_programmed" };
    }
    if (!recipe)
        return { program: program.map(cloneRule), applied: false, reason: "missing_recipe" };
    if (recipe.card_id !== cardId || !recipeIsCompatible(recipe, availableCardIds)) {
        return { program: program.map(cloneRule), applied: false, reason: "incompatible" };
    }
    return {
        program: [...program.map(cloneRule), ...recipe.rules.map((rule) => cloneRule(rule))],
        applied: true,
    };
}
export function autoProgramDeck(program, deckCardIds, selected, availableCardIds) {
    let next = program.map(cloneRule);
    const result = {
        program: next,
        added_card_ids: [],
        already_programmed_card_ids: [],
        missing_recipe_card_ids: [],
        incompatible_card_ids: [],
    };
    for (const cardId of [...new Set(deckCardIds)]) {
        const applied = applyProgramRecipe(next, cardId, selected.get(cardId), availableCardIds);
        next = applied.program;
        if (applied.applied)
            result.added_card_ids.push(cardId);
        else if (applied.reason === "already_programmed")
            result.already_programmed_card_ids.push(cardId);
        else if (applied.reason === "missing_recipe")
            result.missing_recipe_card_ids.push(cardId);
        else
            result.incompatible_card_ids.push(cardId);
    }
    result.program = next;
    return result;
}
export function programLimitStatus(count) {
    const safeCount = Number.isSafeInteger(count) && count >= 0 ? count : 0;
    return { count: safeCount, limit: PROGRAM_RULE_LIMIT, over_by: Math.max(0, safeCount - PROGRAM_RULE_LIMIT), valid: safeCount <= PROGRAM_RULE_LIMIT };
}
