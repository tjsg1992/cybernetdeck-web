export const CURRENT_SUBMISSION_SCHEMA_VERSION = 1;
const LEGACY_CONDITIONS = {
    own_victory_points_at_most: { quantity_target: "your", quantity: "flux", comparison_operator: "<=" },
    opponent_victory_points_at_most: { quantity_target: "opponent", quantity: "flux", comparison_operator: "<=" },
    opponent_victory_points_at_least: { quantity_target: "opponent", quantity: "flux", comparison_operator: ">=" },
    opponent_sync_at_most: { quantity_target: "opponent", quantity: "sync", comparison_operator: "<=" },
};
const LEGACY_QUANTITIES = {
    cards_in_your_deck: ["your", "cards_in_deck"], cards_in_your_hand: ["your", "cards_in_hand"],
    cards_on_your_board: ["your", "cards_on_board"], your_flux: ["your", "flux"], your_ki: ["your", "ki"],
    your_bandwidth: ["your", "bandwidth"], your_sync: ["your", "sync"],
    cards_in_opponent_deck: ["opponent", "cards_in_deck"], cards_in_opponent_hand: ["opponent", "cards_in_hand"],
    cards_on_opponent_board: ["opponent", "cards_on_board"], opponent_flux: ["opponent", "flux"],
    opponent_ki: ["opponent", "ki"], opponent_bandwidth: ["opponent", "bandwidth"], opponent_sync: ["opponent", "sync"],
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const migrationSteps = {
    0: source => {
        const migrated = clone(source);
        if (!Array.isArray(migrated.program ?? []))
            throw Error("A submission program is malformed.");
        migrated.program = (migrated.program ?? []).map((sourceRule) => {
            if (!sourceRule || typeof sourceRule !== "object" || Array.isArray(sourceRule))
                throw Error("A program rule is malformed.");
            const rule = clone(sourceRule);
            const condition = LEGACY_CONDITIONS[rule.condition_type];
            if (condition) {
                const fields = ["quantity_threshold", "victory_points_threshold", "energy_threshold"].filter(key => Object.hasOwn(rule, key));
                const values = [...new Set(fields.map(key => rule[key]))];
                if (!fields.length || values.length !== 1 || !Number.isSafeInteger(values[0]) || values[0] < 0 || values[0] > 65535)
                    throw Error("A legacy threshold condition has contradictory threshold fields.");
                Object.assign(rule, condition, { condition_type: "quantity_compare", quantity_threshold: values[0] });
                delete rule.victory_points_threshold;
                delete rule.energy_threshold;
            }
            else if (rule.condition_type === "quantity_compare" && LEGACY_QUANTITIES[rule.quantity]) {
                const [target, quantity] = LEGACY_QUANTITIES[rule.quantity];
                if (rule.quantity_target !== undefined && rule.quantity_target !== target)
                    throw Error("A legacy quantity condition has a contradictory target.");
                rule.quantity_target = target;
                rule.quantity = quantity;
            }
            return rule;
        });
        migrated.submission_schema_version = 1;
        return migrated;
    },
};
export function migrateSubmission(source) {
    if (!source || typeof source !== "object" || Array.isArray(source))
        throw Error("A submission is malformed.");
    let migrated = clone(source);
    let version = migrated.submission_schema_version ?? 0;
    if (!Number.isSafeInteger(version) || version < 0)
        throw Error("The submission schema version is invalid.");
    if (version > CURRENT_SUBMISSION_SCHEMA_VERSION)
        throw Error("That submission was created by a newer client.");
    while (version < CURRENT_SUBMISSION_SCHEMA_VERSION) {
        const step = migrationSteps[version];
        if (!step)
            throw Error(`No submission migration exists for version ${version}.`);
        migrated = step(migrated);
        version++;
        if (migrated.submission_schema_version !== version)
            throw Error("A submission migration produced the wrong version.");
    }
    return migrated;
}
const CONDITIONS = { if_able: 0, card_in_hand: 1, card_is: 6, quantity_compare: 7 };
const ACTIONS = { play_named_card: 0, play_random_card: 1, end_turn: 2, activate_immutable_card: 3, play_combo: 4 };
const QUANTITIES = {
    "your:cards_in_deck": 0, "your:cards_in_hand": 1, "opponent:cards_in_hand": 2, "your:flux": 3,
    "opponent:flux": 4, "your:sync": 5, "opponent:sync": 6, "your:ki": 7, "your:bandwidth": 8,
    "opponent:cards_in_deck": 9, "your:cards_on_board": 10, "opponent:cards_on_board": 11,
    "opponent:ki": 12, "opponent:bandwidth": 13,
};
const QUANTITY_VALUES = Object.fromEntries(Object.entries(QUANTITIES).map(([key, value]) => [value, key]));
const COMPARISONS = { "<": 0, "<=": 1, "=": 2, ">=": 3, ">": 4 };
const COMPARISON_VALUES = Object.fromEntries(Object.entries(COMPARISONS).map(([key, value]) => [value, key]));
const COMBO_ACTIONS = new Set([4, 5, 6, 7, 8, 9, 10, 11]);
const COMBO_ALL = new Set([6, 7, 10, 11]);
const COMBO_CANCEL = new Set([5, 7, 9, 11]);
const COMBO_ONLY = new Set([8, 9, 10, 11]);
const b64encode = (raw) => btoa(String.fromCharCode(...raw)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const b64decode = (value) => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4)), character => character.charCodeAt(0));
const hexBytes = (value) => {
    if (!/^[0-9a-f]{64}$/i.test(value))
        throw Error("The codec fingerprint must be SHA-256.");
    return Array.from({ length: 32 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
};
function actionCode(rule) {
    if (rule.action_type !== "play_combo")
        return ACTIONS[rule.action_type];
    const all = Boolean(rule.action_card_all_ids?.length), cancel = rule.cancel_if_card_not_played === true, only = rule.only_when_all_cards_in_hand === true;
    return only ? (all ? (cancel ? 11 : 10) : (cancel ? 9 : 8)) : (all ? (cancel ? 7 : 6) : (cancel ? 5 : 4));
}
function accessibleCardIds(decklist, cards = []) {
    const definitions = new Map(cards.map(card => [card.card_id, card]));
    const accessible = new Set(Object.entries(decklist).filter(([, count]) => Number(count) > 0).map(([cardId]) => cardId));
    let changed = true;
    while (changed) {
        changed = false;
        for (const cardId of [...accessible]) {
            const definition = definitions.get(cardId);
            if (!definition)
                continue;
            const related = [...(definition.adds_card_ids ?? []), definition.signature_card_id];
            if (definition.mission_grants_signature_card_id && (!definition.mission_signature_agent_card_id || accessible.has(definition.mission_signature_agent_card_id)))
                related.push(definition.mission_grants_signature_card_id);
            for (const relatedId of related)
                if (relatedId && definitions.has(relatedId) && !accessible.has(relatedId)) {
                    accessible.add(relatedId);
                    changed = true;
                }
        }
    }
    return accessible;
}
function validateRandomAccess(source, cards = []) {
    const accessible = accessibleCardIds(source.decklist ?? {}, cards);
    if ((source.random_card_ids ?? []).some((id) => !accessible.has(id)))
        throw Error("Random-card choices must be cards in or accessible from the deck.");
}
function encodeBody(source, cardIds, cards = []) {
    const submission = migrateSubmission(source), index = new Map(cardIds.map((id, position) => [id, position]));
    const cardIndex = (id) => { const value = index.get(id); if (value === undefined)
        throw Error(`Card ${id} is outside the immutable export catalog.`); return value; };
    if (!submission.decklist || typeof submission.decklist !== "object" || Array.isArray(submission.decklist))
        throw Error("A deck export needs a decklist.");
    const deckCounts = Object.values(submission.decklist);
    const deckSize = deckCounts.reduce((sum, count) => sum + (typeof count === "number" ? count : 0), 0);
    if (deckCounts.some(count => typeof count !== "number" || !Number.isSafeInteger(count) || count <= 0) || deckSize < 20 || deckSize > 30)
        throw Error("The deck must contain 20-30 cards with positive whole-number quantities.");
    Object.keys(submission.decklist).forEach(cardIndex);
    const bytes = cardIds.map(id => Number(submission.decklist[id] ?? 0));
    const rules = submission.program ?? [];
    if (!Array.isArray(rules) || rules.length > 10)
        throw Error("A program can have at most 10 rules.");
    bytes.push(rules.length);
    for (const rule of rules) {
        const condition = CONDITIONS[rule.condition_type], action = actionCode(rule);
        if (condition === undefined || action === undefined)
            throw Error("This deck has an unsupported rule.");
        bytes.push((condition << 4) | action);
        if (condition === 1)
            bytes.push(cardIndex(rule.condition_card_id));
        else if (condition === 6) {
            const locations = { in_your_hand: 0, on_your_side_of_board: 1, on_opponent_side_of_board: 2 };
            bytes.push(cardIndex(rule.condition_card_id), locations[String(rule.card_condition)] ?? -1);
        }
        else if (condition === 7) {
            const quantity = QUANTITIES[`${rule.quantity_target}:${rule.quantity}`], threshold = Number(rule.quantity_threshold);
            if (quantity === undefined || !Number.isSafeInteger(threshold) || threshold < 0 || threshold > 65535)
                throw Error("This deck has an invalid quantity rule.");
            const comparison = COMPARISONS[rule.comparison_operator];
            if (comparison === undefined)
                throw Error("This deck has an invalid quantity comparison.");
            bytes.push(quantity, comparison, threshold >> 8, threshold & 255);
        }
        if (COMBO_ACTIONS.has(action)) {
            const combo = rule.action_card_ids ?? [];
            if (!Array.isArray(combo) || !combo.length || combo.length > 255)
                throw Error("A Combo needs at least one card.");
            bytes.push(combo.length, ...combo.map(cardIndex));
            if (COMBO_ALL.has(action)) {
                const all = rule.action_card_all_ids ?? [];
                if (!Array.isArray(all) || !all.length)
                    throw Error("A Combo all-card selection is invalid.");
                bytes.push(all.length, ...all.map(cardIndex));
            }
        }
        else if (action === 0 || action === 3)
            bytes.push(cardIndex(rule.action_card_id));
    }
    const reactions = submission.reactions ?? [];
    if (!Array.isArray(reactions) || reactions.length > 10)
        throw Error("A reaction program can have at most 10 rules.");
    bytes.push(reactions.length);
    for (const rule of reactions) {
        const threshold = rule.quantity_threshold, comparison = COMPARISONS[rule.comparison_operator];
        if (!Number.isSafeInteger(threshold) || threshold < 0 || threshold > 65535 || comparison === undefined || rule.trigger_type !== "opponent_would_gain_flux")
            throw Error("This deck has an invalid Reaction rule.");
        bytes.push(0, comparison, threshold >> 8, threshold & 255, cardIndex(rule.action_card_id));
    }
    if (!["play_random_card", "end_turn", undefined].includes(submission.default_action))
        throw Error("This deck has an invalid default action.");
    bytes.push(submission.default_action === "end_turn" ? 1 : 0);
    const randomIds = submission.random_card_ids ?? Object.keys(submission.decklist ?? {});
    if (!Array.isArray(randomIds))
        throw Error("Random-card choices are malformed.");
    validateRandomAccess(submission, cards);
    let mask = 0n;
    for (const id of randomIds)
        mask |= 1n << BigInt(cardIndex(id));
    const maskBytes = Math.max(1, Math.ceil(cardIds.length / 8));
    for (let shift = maskBytes - 1; shift >= 0; shift--)
        bytes.push(Number((mask >> BigInt(shift * 8)) & 255n));
    return bytes;
}
export function encodeSubmission(source, catalog) {
    const body = encodeBody(source, catalog.card_ids, catalog.cards);
    return `CD6.${catalog.format_id}.${b64encode([CURRENT_SUBMISSION_SCHEMA_VERSION, ...hexBytes(catalog.fingerprint), ...body])}`;
}
function decodeBody(raw, cardIds, legacyPrefix) {
    const cardAt = (index) => { if (!Number.isSafeInteger(index) || index < 0 || index >= cardIds.length)
        throw Error("That code references an unknown card position."); return cardIds[index]; };
    if (raw.length < cardIds.length + 1)
        throw Error("That deck code is incomplete.");
    const decklist = {};
    cardIds.forEach((id, index) => { if (raw[index])
        decklist[id] = raw[index]; });
    let offset = cardIds.length;
    const ruleCount = raw[offset++], program = [];
    if (ruleCount > 10)
        throw Error("That deck has too many rules.");
    for (let position = 0; position < ruleCount; position++) {
        const header = raw[offset++], condition = header >> 4, action = header & 15;
        const conditionType = Object.keys(CONDITIONS).find(key => CONDITIONS[key] === condition);
        const actionType = COMBO_ACTIONS.has(action) ? "play_combo" : Object.keys(ACTIONS).find(key => ACTIONS[key] === action);
        if (!conditionType || !actionType)
            throw Error("That code has an unsupported rule.");
        const rule = { condition_type: conditionType, action_type: actionType };
        if (condition === 1)
            rule.condition_card_id = cardAt(raw[offset++]);
        else if (condition === 6) {
            rule.condition_card_id = cardAt(raw[offset++]);
            rule.card_condition = ["in_your_hand", "on_your_side_of_board", "on_opponent_side_of_board"][raw[offset++]];
        }
        else if (condition === 7) {
            const [target, quantity] = QUANTITY_VALUES[raw[offset++]].split(":");
            rule.quantity_target = target;
            rule.quantity = quantity;
            rule.comparison_operator = COMPARISON_VALUES[raw[offset++]];
            rule.quantity_threshold = (raw[offset++] << 8) | raw[offset++];
        }
        else if (condition >= 2 && condition <= 5)
            rule.victory_points_threshold = raw[offset++];
        if (COMBO_ACTIONS.has(action)) {
            const count = raw[offset++];
            if (!count)
                throw Error("That code has an invalid Combo.");
            rule.action_card_ids = Array.from({ length: count }, () => cardAt(raw[offset++]));
            if (COMBO_ALL.has(action)) {
                const allCount = raw[offset++];
                if (!allCount)
                    throw Error("That code has an invalid all-card Combo.");
                rule.action_card_all_ids = Array.from({ length: allCount }, () => cardAt(raw[offset++]));
            }
            if (COMBO_CANCEL.has(action))
                rule.cancel_if_card_not_played = true;
            if (COMBO_ONLY.has(action))
                rule.only_when_all_cards_in_hand = true;
        }
        else if (action === 0 || action === 3)
            rule.action_card_id = cardAt(raw[offset++]);
        program.push(rule);
    }
    const reactions = [];
    let defaultByte, mask = 0n;
    if (legacyPrefix === "CD4") {
        defaultByte = raw[offset++];
        mask = BigInt(raw[offset++]);
    }
    else {
        const count = raw[offset++];
        for (let position = 0; position < count; position++) {
            const trigger = raw[offset++], comparison = COMPARISON_VALUES[raw[offset++]], threshold = (raw[offset++] << 8) | raw[offset++], action_card_id = cardAt(raw[offset++]);
            if (trigger !== 0)
                throw Error("That code has an invalid reaction.");
            reactions.push({ trigger_type: "opponent_would_gain_flux", comparison_operator: comparison, quantity_threshold: threshold, action_card_id });
        }
        defaultByte = raw[offset++];
        const byteCount = legacyPrefix === "CD5" ? 2 : Math.max(1, Math.ceil(cardIds.length / 8));
        for (let position = 0; position < byteCount; position++)
            mask = (mask << 8n) | BigInt(raw[offset++]);
    }
    if (offset !== raw.length || defaultByte > 1)
        throw Error("That code has trailing or invalid data.");
    return { owner_name: "", name: "Imported Deck", decklist, program, reactions, default_action: defaultByte ? "end_turn" : "play_random_card", random_card_ids: cardIds.filter((_, index) => (mask & (1n << BigInt(index))) !== 0n), random_eligibility_configured: true };
}
export function decodeSubmission(code, catalogs, expectedFormatId) {
    const normalized = String(code ?? "").replace(/\s+/g, ""), match = /^(CD4|CD5|CD6)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(normalized);
    if (!match || match[2] !== expectedFormatId)
        throw Error("That deck code is for a different or unsupported card format.");
    const raw = b64decode(match[3]);
    if (match[1] === "CD6") {
        if (raw.length < 34 || raw[0] !== CURRENT_SUBMISSION_SCHEMA_VERSION)
            throw Error("That deck code uses an unsupported submission schema.");
        const fingerprint = Array.from(raw.slice(1, 33), value => value.toString(16).padStart(2, "0")).join("");
        const catalog = catalogs.find(candidate => candidate.fingerprint === fingerprint && candidate.format_id === match[2]);
        if (!catalog)
            throw Error("That deck code's immutable card catalog is unavailable.");
        const decoded = migrateSubmission({ ...decodeBody(raw.slice(33), catalog.card_ids), submission_schema_version: raw[0] });
        validateRandomAccess(decoded, catalog.cards);
        return decoded;
    }
    const candidates = catalogs.filter(candidate => candidate.format_id === match[2]);
    const uniqueOrders = new Map(candidates.map(candidate => [candidate.card_ids.join("\0"), candidate]));
    if (uniqueOrders.size !== 1)
        throw Error("That legacy deck code is ambiguous and cannot be decoded safely.");
    const catalog = [...uniqueOrders.values()][0];
    const decoded = migrateSubmission(decodeBody(raw, catalog.card_ids, match[1]));
    validateRandomAccess(decoded, catalog.cards);
    return decoded;
}
