import { DEFAULT_CONFIG, replayBattle, simulateMatch } from "./engine.js";
import { CARD_POOL, SAMPLE_DECKS } from "./cards.js";
function randomSeed() { const values = new Uint32Array(1); crypto.getRandomValues(values); return values[0]; }
self.onmessage = (event) => { const request = event.data; try {
    if (request.type === "simulate") {
        const matches = [], opponents = request.opponents?.length ? request.opponents : SAMPLE_DECKS;
        for (let index = 0; index < opponents.length; index++) {
            const opponent = opponents[index], result = simulateMatch(request.submission, opponent, CARD_POOL, request.games, randomSeed(), { ...DEFAULT_CONFIG, maximum_actions_per_battle: request.actionLimit });
            matches.push({ opponent: opponent.name, opponent_deck: opponent, ...result });
            self.postMessage({ type: "progress", completed: index + 1, total: opponents.length });
        }
        self.postMessage({ type: "complete", matches });
    }
    else {
        const opponent = SAMPLE_DECKS.find(deck => deck.name === request.opponent);
        if (!opponent)
            throw Error("Opponent was not found.");
        const battle = replayBattle(request.submission, opponent, CARD_POOL, request.seed, { ...DEFAULT_CONFIG, maximum_actions_per_battle: request.actionLimit });
        self.postMessage({ type: "replay", battle });
    }
}
catch (error) {
    self.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) });
} };
