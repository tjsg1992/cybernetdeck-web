import { DEFAULT_CONFIG, replayBattle, simulateMatch } from "./engine.js";
import { CARD_POOL } from "./cards.js";
function randomSeed() { const values = new Uint32Array(1); crypto.getRandomValues(values); return values[0]; }
self.onmessage = (event) => { const request = event.data; try {
    if (request.type === "simulate") {
        if (!request.opponents.length)
            throw Error("No tournament opponents were provided.");
        const matches = [], opponents = request.opponents;
        for (let index = 0; index < opponents.length; index++) {
            const opponent = opponents[index], result = simulateMatch(request.submission, opponent, CARD_POOL, request.games, randomSeed(), { ...DEFAULT_CONFIG, maximum_actions_per_battle: request.actionLimit });
            matches.push({ opponent: opponent.owner_name, opponent_deck: opponent, ...result });
            self.postMessage({ type: "progress", completed: index + 1, total: opponents.length });
        }
        self.postMessage({ type: "complete", matches });
    }
    else {
        const startingPlayer = request.startingPlayer ?? (request.gameNumber - 1) % 2, config = { ...DEFAULT_CONFIG, ...request.config, maximum_actions_per_battle: request.actionLimit };
        const battle = replayBattle(request.submission, request.opponent, CARD_POOL, request.seed, config, startingPlayer);
        battle.game_number = request.gameNumber;
        self.postMessage({ type: "replay", battle });
    }
}
catch (error) {
    self.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) });
} };
