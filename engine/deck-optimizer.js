import { DEFAULT_CONFIG, validateSubmission, } from "./engine.js";
function deckSize(decklist) {
    return Object.values(decklist).reduce((total, count) => total + (count > 0 ? count : 0), 0);
}
function copyDeck(decklist) {
    return Object.fromEntries(Object.entries(decklist)
        .filter(([, count]) => count > 0)
        .map(([cardId, count]) => [cardId, count]));
}
export function canonicalDeckKey(decklist) {
    return Object.entries(decklist)
        .filter(([, count]) => count > 0)
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([cardId, count]) => `${cardId}:${count}`)
        .join("|");
}
function baselineCardIds(baseline, cardIds) {
    const baselineIds = new Set(Object.entries(baseline.decklist)
        .filter(([, count]) => count > 0)
        .map(([cardId]) => cardId));
    return cardIds.filter((cardId) => baselineIds.has(cardId));
}
function submissionForDeck(baseline, decklist) {
    const randomCardIds = baseline.random_card_ids?.filter((cardId) => (decklist[cardId] ?? 0) > 0);
    return {
        ...baseline,
        decklist: copyDeck(decklist),
        ...(baseline.random_card_ids
            ? { random_card_ids: randomCardIds }
            : {}),
    };
}
function makeCandidate(baseline, currentDeck, rootCardId, change, cards, config) {
    const submission = submissionForDeck(baseline, currentDeck);
    try {
        validateSubmission(submission, cards, config);
    }
    catch (_error) {
        return null;
    }
    return {
        submission,
        key: canonicalDeckKey(submission.decklist),
        root_card_id: rootCardId,
        change,
    };
}
export function generateRootCandidates(baseline, currentDeck, rootCardId, cardIds, cards, preventBaselineZero, config = DEFAULT_CONFIG) {
    const candidates = [];
    const seen = new Set();
    const currentCount = currentDeck[rootCardId] ?? 0;
    const currentSize = deckSize(currentDeck);
    const add = (nextDeck, change) => {
        const candidate = makeCandidate(baseline, nextDeck, rootCardId, change, cards, config);
        if (candidate && !seen.has(candidate.key)) {
            seen.add(candidate.key);
            candidates.push(candidate);
        }
    };
    if (currentCount > 0 &&
        currentSize - 1 >= config.minimum_deck_size &&
        !(preventBaselineZero && currentCount === 1)) {
        const nextDeck = copyDeck(currentDeck);
        nextDeck[rootCardId] = currentCount - 1;
        add(nextDeck, { kind: "decrease", card_id: rootCardId });
    }
    if (currentSize + 1 <= config.maximum_deck_size &&
        !(cards[rootCardId]?.immutable && currentCount >= 1)) {
        const nextDeck = copyDeck(currentDeck);
        nextDeck[rootCardId] = currentCount + 1;
        add(nextDeck, { kind: "increase", card_id: rootCardId });
    }
    if (currentCount > 0 &&
        !(preventBaselineZero && currentCount === 1)) {
        for (const targetCardId of cardIds) {
            if (targetCardId === rootCardId) {
                continue;
            }
            const targetCount = currentDeck[targetCardId] ?? 0;
            if (cards[targetCardId]?.immutable && targetCount >= 1) {
                continue;
            }
            const nextDeck = copyDeck(currentDeck);
            nextDeck[rootCardId] = currentCount - 1;
            nextDeck[targetCardId] = targetCount + 1;
            add(nextDeck, {
                kind: "transfer",
                from_card_id: rootCardId,
                to_card_id: targetCardId,
            });
        }
    }
    return candidates;
}
export function generateCandidates(baseline, currentDeck, cardIds, cards, preventBaselineZero, config = DEFAULT_CONFIG) {
    const candidates = [];
    const seen = new Set();
    for (const rootCardId of baselineCardIds(baseline, cardIds)) {
        for (const candidate of generateRootCandidates(baseline, currentDeck, rootCardId, baselineCardIds(baseline, cardIds), cards, preventBaselineZero, config)) {
            if (!seen.has(candidate.key)) {
                seen.add(candidate.key);
                candidates.push(candidate);
            }
        }
    }
    return candidates;
}
export function scoreMatches(matches, metric) {
    const wins = matches.map((match) => match.wins).sort((a, b) => a - b);
    const totalWins = wins.reduce((total, value) => total + value, 0);
    const middle = Math.floor(wins.length / 2);
    const medianWins = wins.length === 0
        ? 0
        : wins.length % 2 === 1
            ? wins[middle]
            : (wins[middle - 1] + wins[middle]) / 2;
    return {
        metric,
        total_wins: totalWins,
        median_wins: medianWins,
        value: metric === "total_wins" ? totalWins : medianWins,
    };
}
export function winsPossible(matches, config = DEFAULT_CONFIG) {
    return matches.reduce((total, match) => total + (match.battles.length || config.simulations_per_match), 0);
}
export function requiredImprovementWins(possibleWins, minimumImprovementPercent) {
    return possibleWins * Math.max(0, minimumImprovementPercent) / 100;
}
export async function optimizeDeck(options) {
    const config = options.config ?? DEFAULT_CONFIG;
    const roots = baselineCardIds(options.baseline, options.card_ids);
    const rootTotal = roots.length;
    const baselineKey = canonicalDeckKey(options.baseline.decklist);
    const visited = new Set([baselineKey]);
    const baselineScore = scoreMatches(options.baseline_matches, options.metric);
    const minimumImprovementPercent = Number.isFinite(options.minimum_improvement_percent)
        ? Math.max(0, options.minimum_improvement_percent ?? 0)
        : 0;
    const possibleWins = winsPossible(options.baseline_matches, config);
    const minimumImprovementWins = requiredImprovementWins(possibleWins, minimumImprovementPercent);
    let bestSubmission = options.baseline;
    let bestMatches = options.baseline_matches;
    let bestScore = baselineScore;
    let simulationBatches = 0;
    let rootCompleted = 0;
    let currentRootCardId = null;
    let cancelled = false;
    const alwaysPassGlobalTotalWins = options.always_pass_global_total_wins !== false;
    let globalBestTotalWins = baselineScore.total_wins;
    let traceSequence = 0;
    const pendingTrace = [];
    const yieldControl = options.yield_control ?? (() => new Promise((resolve) => setTimeout(resolve, 0)));
    const isCancelled = () => Boolean(options.should_cancel?.()) || cancelled;
    const progress = async (force = false) => {
        if (!force && simulationBatches % 10 !== 0) {
            return;
        }
        await options.on_progress?.({
            root_completed: rootCompleted,
            root_total: rootTotal,
            current_root_card_id: currentRootCardId,
            simulation_batches: simulationBatches,
            best_score: bestScore,
            visited_decks: visited.size,
            trace: pendingTrace.splice(0),
            wins_possible: possibleWins,
            minimum_improvement_percent: minimumImprovementPercent,
            minimum_improvement_wins: minimumImprovementWins,
            global_best_total_wins: globalBestTotalWins,
            always_pass_global_total_wins: alwaysPassGlobalTotalWins,
        });
    };
    const addTrace = (event) => {
        pendingTrace.push({ sequence: ++traceSequence, ...event });
    };
    const visit = async (candidate, parentScore, rootCardId, depth, parentKey) => {
        if (isCancelled()) {
            cancelled = true;
            return;
        }
        if (visited.has(candidate.key)) {
            addTrace({
                kind: "skip-visited",
                root_card_id: rootCardId,
                depth,
                change: candidate.change,
                parent_key: parentKey,
                candidate_key: candidate.key,
                parent_score: parentScore,
                simulation_batch: null,
                score_delta: null,
                required_improvement: minimumImprovementWins,
                parent_improvement_pass: false,
                global_best_total_wins: globalBestTotalWins,
                global_total_wins_pass: false,
                improved_parent: false,
                new_global_best: false,
                decision: "skip-visited",
            });
            return;
        }
        visited.add(candidate.key);
        const matches = await options.evaluate(candidate.submission);
        simulationBatches += 1;
        const score = scoreMatches(matches, options.metric);
        const scoreDelta = score.value - parentScore.value;
        const parentImprovementPass = minimumImprovementWins > 0
            ? scoreDelta >= minimumImprovementWins
            : scoreDelta > 0;
        const globalBestTotalWinsBefore = globalBestTotalWins;
        const globalTotalWinsPass = alwaysPassGlobalTotalWins &&
            score.total_wins > globalBestTotalWinsBefore;
        const improvedParent = parentImprovementPass || globalTotalWinsPass;
        const newGlobalBest = improvedParent && score.value > bestScore.value;
        if (improvedParent && score.total_wins > globalBestTotalWins) {
            globalBestTotalWins = score.total_wins;
        }
        if (newGlobalBest) {
            bestSubmission = candidate.submission;
            bestMatches = matches;
            bestScore = score;
        }
        addTrace({
            kind: "evaluated",
            root_card_id: rootCardId,
            depth,
            change: candidate.change,
            parent_key: parentKey,
            candidate_key: candidate.key,
            parent_score: parentScore,
            candidate_score: score,
            simulation_batch: simulationBatches,
            score_delta: scoreDelta,
            required_improvement: minimumImprovementWins,
            parent_improvement_pass: parentImprovementPass,
            global_best_total_wins: globalBestTotalWinsBefore,
            global_total_wins_pass: globalTotalWinsPass,
            improved_parent: improvedParent,
            new_global_best: newGlobalBest,
            decision: improvedParent ? "recurse" : "prune",
        });
        await progress();
        if (!improvedParent) {
            return;
        }
        await yieldControl();
        for (const next of generateCandidates(options.baseline, candidate.submission.decklist, options.card_ids, options.cards, options.prevent_baseline_zero, config)) {
            if (isCancelled()) {
                cancelled = true;
                return;
            }
            await visit(next, score, rootCardId, depth + 1, candidate.key);
        }
    };
    for (const rootCardId of roots) {
        if (isCancelled()) {
            cancelled = true;
            break;
        }
        currentRootCardId = rootCardId;
        for (const candidate of generateRootCandidates(options.baseline, options.baseline.decklist, rootCardId, roots, options.cards, options.prevent_baseline_zero, config)) {
            await visit(candidate, baselineScore, rootCardId, 1, baselineKey);
            if (isCancelled()) {
                cancelled = true;
                break;
            }
        }
        if (cancelled) {
            break;
        }
        rootCompleted += 1;
        await progress(true);
    }
    currentRootCardId = cancelled ? currentRootCardId : null;
    await progress(true);
    return {
        best_submission: bestSubmission,
        best_matches: bestMatches,
        best_score: bestScore,
        simulation_batches: simulationBatches,
        root_completed: rootCompleted,
        root_total: rootTotal,
        current_root_card_id: currentRootCardId,
        visited_decks: visited.size,
        wins_possible: possibleWins,
        minimum_improvement_percent: minimumImprovementPercent,
        minimum_improvement_wins: minimumImprovementWins,
        global_best_total_wins: globalBestTotalWins,
        always_pass_global_total_wins: alwaysPassGlobalTotalWins,
        cancelled,
    };
}
export const OPTIMIZATION_PROFILES = {
    quick: {
        profile: "quick",
        battle_budget: 125_000,
        screen_games: 16,
        promote_games: 64,
        finalist_games: 256,
        validation_games: 500,
        max_screened: 700,
        max_finalists: 3,
    },
    balanced: {
        profile: "balanced",
        battle_budget: 500_000,
        screen_games: 32,
        promote_games: 128,
        finalist_games: 512,
        validation_games: 1_000,
        max_screened: 1_500,
        max_finalists: 5,
    },
    thorough: {
        profile: "thorough",
        battle_budget: 1_250_000,
        screen_games: 64,
        promote_games: 256,
        finalist_games: 1_000,
        validation_games: 2_000,
        max_screened: 3_000,
        max_finalists: 6,
    },
};
function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}
function wilsonInterval(wins, games) {
    if (!games)
        return { rate: 0, lower: 0, upper: 1, games: 0, wins: 0 };
    const rate = wins / games;
    const z = 1.96;
    const denominator = 1 + (z * z) / games;
    const center = (rate + (z * z) / (2 * games)) / denominator;
    const spread = z * Math.sqrt((rate * (1 - rate) + (z * z) / (4 * games)) / games) / denominator;
    return { rate, lower: clamp01(center - spread), upper: clamp01(center + spread), games, wins };
}
function empiricalBernstein(values, confidence = 0.95) {
    if (!values.length)
        return { estimate: 0, lower: -1, upper: 1 };
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const delta = Math.max(1e-9, 1 - confidence);
    const log = Math.log(3 / delta);
    const radius = Math.sqrt((2 * variance * log) / values.length) + (3 * log) / values.length;
    return { estimate: mean, lower: Math.max(-1, mean - radius), upper: Math.min(1, mean + radius) };
}
function mergeMatches(existing, additions) {
    const byOpponent = new Map(existing.map(match => [match.opponent, match]));
    for (const addition of additions) {
        const prior = byOpponent.get(addition.opponent);
        if (!prior) {
            byOpponent.set(addition.opponent, { ...addition, battles: [...addition.battles] });
            continue;
        }
        const seen = new Set(prior.battles.map(battle => `${battle.seed}:${battle.starting_player}`));
        for (const battle of addition.battles) {
            const key = `${battle.seed}:${battle.starting_player}`;
            if (!seen.has(key)) {
                prior.battles.push(battle);
                seen.add(key);
            }
        }
        prior.wins = prior.battles.filter(battle => battle.winner_id === "first").length;
        prior.losses = prior.battles.filter(battle => battle.winner_id === "second").length;
        prior.draws = prior.battles.length - prior.wins - prior.losses;
    }
    return [...byOpponent.values()];
}
function matchupIntervals(matches) {
    return matches.map(match => wilsonInterval(match.wins, match.battles.length));
}
function budgetedScore(matches, objective) {
    const intervals = matchupIntervals(matches);
    const rates = intervals.map(interval => interval.rate).sort((a, b) => a - b);
    const bottomCount = Math.max(1, Math.ceil(rates.length * 0.4));
    const bottom40 = rates.slice(0, bottomCount);
    const wins = matches.map(match => match.wins).sort((a, b) => a - b);
    const totalWins = wins.reduce((total, value) => total + value, 0);
    const totalGames = matches.reduce((total, match) => total + match.battles.length, 0);
    const totalInterval = wilsonInterval(totalWins, totalGames);
    const totalRate = totalInterval.rate;
    const bottom40Rate = bottom40.length ? bottom40.reduce((sum, value) => sum + value, 0) / bottom40.length : 0;
    const worstRate = rates[0] ?? 0;
    const middle = Math.floor(wins.length / 2);
    const medianWins = wins.length === 0 ? 0 : wins.length % 2 ? wins[middle] : (wins[middle - 1] + wins[middle]) / 2;
    const value = objective === "worst_matchup" ? worstRate : objective === "resilient_total" ? totalRate : totalWins;
    return {
        metric: objective === "total_wins" ? "total_wins" : "median_wins",
        objective,
        total_wins: totalWins,
        median_wins: medianWins,
        value,
        total_rate: totalRate,
        bottom40_rate: bottom40Rate,
        worst_rate: worstRate,
        total_interval: totalInterval,
        matchup_intervals: intervals,
    };
}
function scorePriority(score, objective) {
    if (objective === "worst_matchup")
        return [score.worst_rate, score.total_rate, score.bottom40_rate];
    if (objective === "total_wins")
        return [score.total_wins, score.bottom40_rate, score.worst_rate];
    return [score.total_rate, score.bottom40_rate, score.worst_rate];
}
function compareBudgetedScores(left, right, objective) {
    const a = scorePriority(left, objective);
    const b = scorePriority(right, objective);
    for (let index = 0; index < a.length; index++) {
        if (a[index] !== b[index])
            return a[index] - b[index];
    }
    return 0;
}
function pairedBounds(candidate, incumbent) {
    const incumbentByOpponent = new Map(incumbent.map(match => [match.opponent, match]));
    const values = [];
    for (const match of candidate) {
        const prior = incumbentByOpponent.get(match.opponent);
        if (!prior)
            continue;
        const priorBySeed = new Map(prior.battles.map(battle => [`${battle.seed}:${battle.starting_player}`, battle]));
        for (const battle of match.battles) {
            const previous = priorBySeed.get(`${battle.seed}:${battle.starting_player}`);
            if (!previous)
                continue;
            values.push((battle.winner_id === "first" ? 1 : 0) - (previous.winner_id === "first" ? 1 : 0));
        }
    }
    return empiricalBernstein(values);
}
function intervalStandardError(interval) {
    return Math.max(0, (interval.upper - interval.lower) / (2 * 1.96));
}
function l1Distance(first, second, ids) {
    return ids.reduce((sum, id) => sum + Math.abs((first[id] ?? 0) - (second[id] ?? 0)), 0);
}
function solveRidge(matrix, vector, lambda) {
    const size = vector.length;
    const augmented = matrix.map((row, rowIndex) => [...row.map((value, columnIndex) => value + (rowIndex === columnIndex ? lambda : 0)), vector[rowIndex]]);
    for (let column = 0; column < size; column++) {
        let pivot = column;
        for (let row = column + 1; row < size; row++)
            if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column]))
                pivot = row;
        if (Math.abs(augmented[pivot][column]) < 1e-9)
            continue;
        [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
        const divisor = augmented[column][column];
        for (let index = column; index <= size; index++)
            augmented[column][index] /= divisor;
        for (let row = 0; row < size; row++) {
            if (row === column)
                continue;
            const factor = augmented[row][column];
            if (!factor)
                continue;
            for (let index = column; index <= size; index++)
                augmented[row][index] -= factor * augmented[column][index];
        }
    }
    return augmented.map(row => row[size] || 0);
}
function modelFeatures(deck, ids) {
    const values = ids.map(id => deck[id] ?? 0);
    const features = [1, ...values.map(value => value / 10), ...values.map(value => (value * value) / 100)];
    for (let first = 0; first < values.length; first++)
        for (let second = first + 1; second < values.length; second++)
            features.push((values[first] * values[second]) / 100);
    return features;
}
function modelProposal(observations, start, baseline, ids, cards, preventBaselineZero, config) {
    if (observations.length < Math.min(12, ids.length + 3))
        return null;
    const featureCount = modelFeatures(start.candidate.submission.decklist, ids).length;
    const matrix = Array.from({ length: featureCount }, () => Array(featureCount).fill(0));
    const vector = Array(featureCount).fill(0);
    for (const observation of observations) {
        const features = modelFeatures(observation.candidate.submission.decklist, ids);
        const target = observation.score.total_rate;
        for (let row = 0; row < featureCount; row++) {
            vector[row] += features[row] * target;
            for (let column = 0; column < featureCount; column++)
                matrix[row][column] += features[row] * features[column];
        }
    }
    const coefficients = solveRidge(matrix, vector, 0.5);
    const predicted = (deck) => modelFeatures(deck, ids).reduce((sum, feature, index) => sum + feature * coefficients[index], 0);
    let current = copyDeck(start.candidate.submission.decklist);
    let currentValue = predicted(current);
    for (let step = 0; step < ids.length * 2; step++) {
        let best = null;
        let bestValue = currentValue;
        for (const candidate of generateCandidates(baseline, current, ids, cards, preventBaselineZero, config)) {
            const value = predicted(candidate.submission.decklist);
            if (value > bestValue + 1e-9) {
                best = candidate.submission.decklist;
                bestValue = value;
            }
        }
        if (!best)
            break;
        current = copyDeck(best);
        currentValue = bestValue;
    }
    return makeCandidate(baseline, current, start.candidate.root_card_id, { kind: "increase", card_id: ids[0] ?? "" }, cards, config);
}
export async function optimizeDeckBudgeted(options) {
    const profile = OPTIMIZATION_PROFILES[options.profile ?? "balanced"];
    const objective = options.objective ?? "resilient_total";
    const config = options.config ?? DEFAULT_CONFIG;
    const optimizerSeed = (options.optimizer_seed ?? 1) >>> 0;
    const opponentCount = options.baseline_matches.length;
    if (!opponentCount)
        throw Error("No optimization opponents were provided.");
    const ids = baselineCardIds(options.baseline, options.card_ids);
    const searchSeeds = Array.from({ length: profile.finalist_games }, (_, index) => Array.from({ length: opponentCount }, (_, opponent) => {
        let value = (optimizerSeed ^ 0x9e3779b9 ^ (index * 0x85ebca6b) ^ (opponent * 0xc2b2ae35)) >>> 0;
        value = Math.imul(value ^ (value >>> 16), 0x45d9f3b) >>> 0;
        value = Math.imul(value ^ (value >>> 16), 0x45d9f3b) >>> 0;
        return (value ^ (value >>> 16)) >>> 0;
    }));
    const validationSeeds = Array.from({ length: profile.validation_games }, (_, index) => Array.from({ length: opponentCount }, (_, opponent) => {
        let value = (optimizerSeed ^ 0x7f4a7c15 ^ (index * 0x27d4eb2d) ^ (opponent * 0x165667b1)) >>> 0;
        value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d) >>> 0;
        return (value ^ (value >>> 13)) >>> 0;
    }));
    // The public evaluator receives one seed list per opponent. Re-shape the bank once.
    const bankFor = (bank, offset, games) => Array.from({ length: opponentCount }, (_, opponent) => Array.from({ length: games }, (_, index) => bank[offset + index][opponent]));
    const yieldControl = options.yield_control ?? (() => new Promise(resolve => setTimeout(resolve, 0)));
    let battlesConsumed = 0;
    let decksScreened = 0;
    let decksPromoted = 0;
    let decksValidated = 0;
    let traceSequence = 0;
    const pendingTrace = [];
    let cancelled = false;
    let stopReason = "frontier-exhausted";
    const gamesAvailable = (requested) => Math.max(0, Math.min(requested, Math.floor((profile.battle_budget - battlesConsumed) / opponentCount)));
    const progress = async (phase, bestScore, frontierSize) => {
        await options.on_progress?.({
            phase, profile: profile.profile, objective, optimizer_seed: optimizerSeed,
            battle_budget: profile.battle_budget, battles_consumed: battlesConsumed,
            full_batch_equivalents: battlesConsumed / (opponentCount * config.simulations_per_match),
            decks_screened: decksScreened, decks_promoted: decksPromoted, decks_validated: decksValidated, frontier_size: frontierSize,
            best_score: bestScore, trace: pendingTrace.splice(0),
        });
    };
    const addTrace = (event) => pendingTrace.push({ sequence: ++traceSequence, ...event });
    const isCancelled = () => Boolean(options.should_cancel?.());
    const observations = [];
    const visited = new Set([canonicalDeckKey(options.baseline.decklist)]);
    const frontier = new Map();
    const baselineCandidate = makeCandidate(options.baseline, options.baseline.decklist, ids[0] ?? "", { kind: "increase", card_id: ids[0] ?? "" }, options.cards, config);
    if (!baselineCandidate)
        throw Error("Baseline submission is not valid for optimization.");
    const baselineSearchMatches = await options.evaluate(options.baseline, { stage: "screen", games_per_opponent: profile.screen_games, seed_offset: 0, seed_bank: bankFor(searchSeeds, 0, profile.screen_games), candidate_key: canonicalDeckKey(options.baseline.decklist) });
    if (baselineSearchMatches.length !== opponentCount)
        throw Error("The baseline matchup set does not match the optimization opponent set.");
    battlesConsumed += profile.screen_games * opponentCount;
    let bestNode = { candidate: baselineCandidate, matches: baselineSearchMatches, score: budgetedScore(baselineSearchMatches, objective), games_per_opponent: profile.screen_games, parent_key: null, distance: 0 };
    observations.push(bestNode);
    const addNeighbors = (node) => {
        for (const candidate of generateCandidates(options.baseline, node.candidate.submission.decklist, options.card_ids, options.cards, options.prevent_baseline_zero, config)) {
            if (visited.has(candidate.key) || frontier.has(candidate.key))
                continue;
            frontier.set(candidate.key, { candidate, parent_key: node.candidate.key, distance: node.distance + 1, priority: node.score.total_rate - (node.distance + 1) * 0.0001 });
        }
    };
    addNeighbors(bestNode);
    const selectFrontier = () => {
        const entries = [...frontier.values()];
        entries.sort((left, right) => {
            if (left.priority !== right.priority)
                return right.priority - left.priority;
            if (left.distance !== right.distance)
                return left.distance - right.distance;
            return left.candidate.key.localeCompare(right.candidate.key);
        });
        return entries[0];
    };
    const screenBudget = Math.floor(profile.battle_budget * 0.6);
    while (frontier.size && decksScreened < profile.max_screened && battlesConsumed + profile.screen_games * opponentCount <= screenBudget) {
        if (isCancelled()) {
            cancelled = true;
            stopReason = "cancelled";
            break;
        }
        const next = selectFrontier();
        if (!next)
            break;
        frontier.delete(next.candidate.key);
        visited.add(next.candidate.key);
        const matches = await options.evaluate(next.candidate.submission, { stage: "screen", games_per_opponent: profile.screen_games, seed_offset: 0, seed_bank: bankFor(searchSeeds, 0, profile.screen_games), candidate_key: next.candidate.key });
        battlesConsumed += profile.screen_games * opponentCount;
        decksScreened++;
        const node = { candidate: next.candidate, matches, score: budgetedScore(matches, objective), games_per_opponent: profile.screen_games, parent_key: next.parent_key, distance: next.distance };
        observations.push(node);
        const bounds = pairedBounds(matches, bestNode.matches);
        const likely = compareBudgetedScores(node.score, bestNode.score, objective) >= 0 || bounds.upper >= 0;
        addTrace({ phase: "screen", candidate_key: node.candidate.key, parent_key: node.parent_key, decision: likely ? "screen" : "prune", score: node.score, reason: likely ? "kept in adaptive frontier" : "low-confidence loser retained for model context" });
        if (compareBudgetedScores(node.score, bestNode.score, objective) > 0)
            bestNode = node;
        if (likely || decksScreened % 4 === 0)
            addNeighbors(node);
        if (decksScreened % 16 === 0) {
            const proposal = modelProposal(observations.slice(-128), bestNode, options.baseline, ids, options.cards, options.prevent_baseline_zero, config);
            if (proposal && !visited.has(proposal.key) && !frontier.has(proposal.key)) {
                frontier.set(proposal.key, { candidate: proposal, parent_key: bestNode.candidate.key, distance: bestNode.distance + 1, priority: bestNode.score.total_rate + 0.0002 });
                addTrace({ phase: "screen", candidate_key: proposal.key, parent_key: bestNode.candidate.key, decision: "model-proposal", score: null, reason: "quadratic response-model proposal" });
            }
            await progress("screen", bestNode.score, frontier.size);
            await yieldControl();
        }
    }
    if (!cancelled && !frontier.size && decksScreened < profile.max_screened)
        stopReason = "frontier-exhausted";
    const ranked = () => [...observations].sort((left, right) => compareBudgetedScores(right.score, left.score, objective));
    const promoteCount = Math.min(profile.max_screened, Math.max(1, Math.min(64, ranked().length)));
    for (const node of ranked().slice(0, promoteCount)) {
        if (cancelled)
            break;
        if (node.games_per_opponent >= profile.promote_games)
            continue;
        const requestedGames = profile.promote_games - node.games_per_opponent;
        const additionalGames = gamesAvailable(requestedGames);
        if (!additionalGames) {
            stopReason = "budget";
            break;
        }
        const additional = await options.evaluate(node.candidate.submission, { stage: "promote", games_per_opponent: additionalGames, seed_offset: node.games_per_opponent, seed_bank: bankFor(searchSeeds, node.games_per_opponent, additionalGames), candidate_key: node.candidate.key });
        node.matches = mergeMatches(node.matches, additional);
        node.games_per_opponent += additionalGames;
        node.score = budgetedScore(node.matches, objective);
        battlesConsumed += additional.reduce((sum, match) => sum + match.battles.length, 0);
        decksPromoted++;
        addTrace({ phase: "promote", candidate_key: node.candidate.key, parent_key: node.parent_key, decision: "promote", score: node.score, reason: "survived low-fidelity screening" });
        if (compareBudgetedScores(node.score, bestNode.score, objective) > 0)
            bestNode = node;
        await progress("promote", bestNode.score, frontier.size);
        await yieldControl();
    }
    const finalistCount = Math.min(profile.max_finalists, ranked().length);
    for (const node of ranked().slice(0, finalistCount)) {
        if (cancelled || node.games_per_opponent >= profile.finalist_games)
            continue;
        const requestedGames = profile.finalist_games - node.games_per_opponent;
        const additionalGames = gamesAvailable(requestedGames);
        if (!additionalGames) {
            stopReason = "budget";
            break;
        }
        const additional = await options.evaluate(node.candidate.submission, { stage: "finalist", games_per_opponent: additionalGames, seed_offset: node.games_per_opponent, seed_bank: bankFor(searchSeeds, node.games_per_opponent, additionalGames), candidate_key: node.candidate.key });
        node.matches = mergeMatches(node.matches, additional);
        const addedGames = additional.reduce((sum, match) => sum + match.battles.length, 0);
        node.games_per_opponent += additionalGames;
        node.score = budgetedScore(node.matches, objective);
        battlesConsumed += addedGames;
        addTrace({ phase: "finalist", candidate_key: node.candidate.key, parent_key: node.parent_key, decision: "promote", score: node.score, reason: "final search fidelity" });
        if (compareBudgetedScores(node.score, bestNode.score, objective) > 0)
            bestNode = node;
        await progress("finalist", bestNode.score, frontier.size);
        await yieldControl();
    }
    const finalists = ranked().slice(0, Math.min(profile.max_finalists, ranked().length));
    const validationEntries = [];
    const validationGames = Math.min(profile.validation_games, Math.floor((profile.battle_budget - battlesConsumed) / (opponentCount * Math.max(1, finalists.length + 1))));
    if (!validationGames) {
        stopReason = "budget";
        return {
            best_submission: options.baseline,
            best_matches: options.baseline_matches,
            best_score: budgetedScore(options.baseline_matches, objective),
            baseline_validation_matches: options.baseline_matches,
            baseline_validation_score: budgetedScore(options.baseline_matches, objective),
            validation_candidates: [], profile: profile.profile, objective, optimizer_seed: optimizerSeed,
            battle_budget: profile.battle_budget, battles_consumed: battlesConsumed,
            full_batch_equivalents: battlesConsumed / (opponentCount * config.simulations_per_match),
            decks_screened: decksScreened, decks_promoted: decksPromoted, decks_validated: 0,
            cancelled, stop_reason: stopReason,
        };
    }
    const validationBase = await options.evaluate(options.baseline, { stage: "validation", games_per_opponent: validationGames, seed_offset: 0, seed_bank: bankFor(validationSeeds, 0, validationGames), candidate_key: canonicalDeckKey(options.baseline.decklist) });
    battlesConsumed += validationBase.reduce((sum, match) => sum + match.battles.length, 0);
    const baselineValidationScore = budgetedScore(validationBase, objective);
    for (const node of finalists) {
        if (isCancelled()) {
            cancelled = true;
            stopReason = "cancelled";
            break;
        }
        const matches = await options.evaluate(node.candidate.submission, { stage: "validation", games_per_opponent: validationGames, seed_offset: 0, seed_bank: bankFor(validationSeeds, 0, validationGames), candidate_key: node.candidate.key });
        battlesConsumed += matches.reduce((sum, match) => sum + match.battles.length, 0);
        decksValidated++;
        const score = budgetedScore(matches, objective);
        const delta = pairedBounds(matches, validationBase);
        const totalNonInferior = score.total_interval.lower >= baselineValidationScore.total_interval.rate - 0.01;
        const objectiveImprovement = objective === "worst_matchup"
            ? score.worst_rate > baselineValidationScore.worst_rate
            : delta.lower > 0;
        const recommendation = objectiveImprovement || (totalNonInferior && score.bottom40_rate > baselineValidationScore.bottom40_rate) ? "selected" : "not-supported";
        validationEntries.push({ submission: node.candidate.submission, matches, score, recommendation });
        addTrace({ phase: "validation", candidate_key: node.candidate.key, parent_key: node.parent_key, decision: "validate", score, reason: recommendation === "selected" ? "independent validation supports candidate" : "independent validation did not support candidate" });
        await progress("validation", score, frontier.size);
        await yieldControl();
    }
    const supported = validationEntries.filter(entry => entry.recommendation === "selected");
    let selected;
    if (supported.length) {
        if (objective === "resilient_total") {
            const topRate = Math.max(...supported.map(entry => entry.score.total_rate));
            const topEntry = supported.find(entry => entry.score.total_rate === topRate) ?? supported[0];
            const tolerance = intervalStandardError(topEntry.score.total_interval);
            const equivalent = supported.filter(entry => topRate - entry.score.total_rate <= tolerance + 1e-9);
            equivalent.sort((left, right) => right.score.bottom40_rate - left.score.bottom40_rate || right.score.worst_rate - left.score.worst_rate || right.score.total_rate - left.score.total_rate);
            selected = equivalent[0];
        }
        else {
            selected = [...supported].sort((left, right) => compareBudgetedScores(right.score, left.score, objective))[0];
        }
    }
    const finalMatches = selected?.matches ?? validationBase;
    const finalScore = selected?.score ?? baselineValidationScore;
    if (!cancelled && battlesConsumed >= profile.battle_budget) {
        stopReason = "budget";
    }
    await progress("validation", finalScore, frontier.size);
    return {
        best_submission: selected?.submission ?? options.baseline,
        best_matches: finalMatches,
        best_score: finalScore,
        baseline_validation_matches: validationBase,
        baseline_validation_score: baselineValidationScore,
        validation_candidates: validationEntries,
        profile: profile.profile,
        objective,
        optimizer_seed: optimizerSeed,
        battle_budget: profile.battle_budget,
        battles_consumed: battlesConsumed,
        full_batch_equivalents: battlesConsumed / (opponentCount * config.simulations_per_match),
        decks_screened: decksScreened,
        decks_promoted: decksPromoted,
        decks_validated: decksValidated,
        cancelled,
        stop_reason: stopReason,
    };
}
