import { DEFAULT_CONFIG, replayBattle, simulateMatch, } from "./engine.js?v=b601feba6418";
import { optimizeDeckBudgeted, } from "./deck-optimizer.js?v=b601feba6418";
import { CARD_POOL } from "./cards.js?v=b601feba6418";
let cancelRequested = false;
function randomSeed() {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0];
}
function summarizeBattles(opponent, baseline, submission, config) {
    const battles = baseline.battles.map((record, index) => {
        const detailed = replayBattle(submission, opponent, CARD_POOL, record.seed, config, record.starting_player, undefined, false);
        const { log: _log, ...summary } = detailed;
        return {
            ...summary,
            game_number: record.game_number ?? index + 1,
            seed: record.seed,
            starting_player: record.starting_player,
        };
    });
    const wins = battles.filter((battle) => battle.winner_id === "first").length;
    const losses = battles.filter((battle) => battle.winner_id === "second").length;
    return {
        opponent: baseline.opponent || opponent.owner_name,
        opponent_deck: opponent,
        battles,
        wins,
        losses,
        draws: battles.length - wins - losses,
    };
}
function summarizeSeededBattles(opponent, submission, seeds, gameOffset, config) {
    const battles = seeds.map((seed, index) => {
        const startingPlayer = ((gameOffset + index) % 2);
        const detailed = replayBattle(submission, opponent, CARD_POOL, seed, config, startingPlayer, undefined, false);
        const { log: _log, ...summary } = detailed;
        return {
            ...summary,
            game_number: gameOffset + index + 1,
            seed,
            starting_player: startingPlayer,
        };
    });
    const wins = battles.filter((battle) => battle.winner_id === "first").length;
    const losses = battles.filter((battle) => battle.winner_id === "second").length;
    return {
        opponent: opponent.owner_name,
        opponent_deck: opponent,
        battles,
        wins,
        losses,
        draws: battles.length - wins - losses,
    };
}
async function handle(request) {
    if (request.type === "simulate") {
        if (!request.opponents.length) {
            throw Error("No tournament opponents were provided.");
        }
        const matches = [];
        for (let index = 0; index < request.opponents.length; index++) {
            const opponent = request.opponents[index];
            const result = simulateMatch(request.submission, opponent, CARD_POOL, request.games, randomSeed(), { ...DEFAULT_CONFIG, maximum_actions_per_battle: request.actionLimit });
            matches.push({ opponent: opponent.owner_name, opponent_deck: opponent, ...result });
            self.postMessage({ type: "progress", completed: index + 1, total: request.opponents.length });
        }
        self.postMessage({ type: "complete", matches });
        return;
    }
    if (request.type === "replay") {
        const startingPlayer = request.startingPlayer ?? (request.gameNumber - 1) % 2;
        const config = {
            ...DEFAULT_CONFIG,
            ...request.config,
            maximum_actions_per_battle: request.actionLimit,
        };
        const battle = replayBattle(request.submission, request.opponent, CARD_POOL, request.seed, config, startingPlayer, request.setup);
        battle.game_number = request.gameNumber;
        self.postMessage({ type: "replay", battle });
        return;
    }
    const config = {
        ...DEFAULT_CONFIG,
        ...request.config,
        maximum_actions_per_battle: request.actionLimit,
    };
    if (request.baselineMatches.length !== request.opponents.length) {
        throw Error("The baseline matchup set does not match the optimization opponent set.");
    }
    const result = await optimizeDeckBudgeted({
        baseline: request.submission,
        baseline_matches: request.baselineMatches,
        card_ids: request.cardIds,
        cards: CARD_POOL,
        prevent_baseline_zero: request.preventBaselineZero,
        profile: request.profile ?? "balanced",
        objective: request.objective ?? (request.metric === "total_wins" ? "total_wins" : "resilient_total"),
        optimizer_seed: request.optimizerSeed ?? 1,
        config,
        should_cancel: () => cancelRequested,
        evaluate: async (submission, evaluation) => request.opponents.map((opponent, index) => {
            const seeds = evaluation.seed_bank[index] ?? [];
            return summarizeSeededBattles(opponent, submission, seeds, evaluation.seed_offset, config);
        }),
        on_progress: (progress) => {
            self.postMessage({ type: "optimize-progress", ...progress });
        },
    });
    self.postMessage({ type: "optimize-complete", result });
}
self.onmessage = (event) => {
    const request = event.data;
    if (request.type === "cancel") {
        cancelRequested = true;
        return;
    }
    cancelRequested = false;
    void handle(request).catch((error) => {
        self.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) });
    });
};
