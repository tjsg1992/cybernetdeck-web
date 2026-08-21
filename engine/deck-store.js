export class DeckStoreError extends Error {
    status;
    code;
    current;
    retryable;
    constructor(status, code, message, current) {
        super(message);
        this.name = "DeckStoreError";
        this.status = status;
        this.code = code;
        this.current = current;
        this.retryable = status === 0 || status >= 500 || code === "request_failed";
    }
}
export function normalizeName(value) {
    const displayName = String(value ?? "").trim().normalize("NFKC");
    if (!displayName)
        throw new DeckStoreError(400, "invalid_name", "Name cannot be empty.");
    if ([...displayName].length > 80)
        throw new DeckStoreError(400, "invalid_name", "Name cannot exceed 80 characters.");
    return { displayName, nameKey: displayName.toLowerCase() };
}
function canonicalize(value) {
    if (Array.isArray(value))
        return value.map(canonicalize);
    if (!value || typeof value !== "object")
        return value;
    const object = value;
    return Object.fromEntries(Object.keys(object).sort().map((key) => [key, canonicalize(object[key])]));
}
export function stableJson(value) {
    return JSON.stringify(canonicalize(value));
}
export async function legacyImportFingerprint(legacyKey, draft) {
    const source = `${legacyKey}\0${stableJson(draft)}`;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
export class DeckStore {
    baseUrl;
    fetchImpl;
    playerId;
    constructor(options) {
        this.baseUrl = options.baseUrl.trim().replace(/\/$/, "");
        // Window.fetch requires the Window receiver when invoked in a browser.
        // Keep injected test fetches untouched, but bind the native default.
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    }
    get hasBaseUrl() {
        return Boolean(this.baseUrl);
    }
    get currentPlayerId() {
        return this.playerId;
    }
    clearSession() {
        this.playerId = undefined;
    }
    url(path) {
        if (!this.baseUrl)
            throw new DeckStoreError(0, "api_unconfigured", "Cloud deck storage is not configured.");
        return new URL(path.replace(/^\//, ""), `${this.baseUrl}/`).toString();
    }
    async request(path, init = {}, authenticated = true) {
        const headers = new Headers(init.headers);
        headers.set("Accept", "application/json");
        if (init.body !== undefined)
            headers.set("Content-Type", "application/json");
        if (authenticated && this.playerId)
            headers.set("X-Player-Id", this.playerId);
        try {
            const response = await this.fetchImpl(this.url(path), { ...init, headers });
            const raw = await response.text();
            let data = {};
            if (raw) {
                try {
                    data = JSON.parse(raw);
                }
                catch {
                    data = {};
                }
            }
            if (!response.ok) {
                const body = data;
                throw new DeckStoreError(response.status, body.error?.code ?? "request_failed", body.error?.message ?? `Deck request failed (${response.status}).`, body.error?.current);
            }
            return data;
        }
        catch (error) {
            if (error instanceof DeckStoreError)
                throw error;
            throw new DeckStoreError(0, "request_failed", error instanceof Error ? error.message : "Cloud deck request failed.");
        }
    }
    async login(name) {
        const result = await this.request("/v1/login", {
            method: "POST",
            body: JSON.stringify({ name }),
        }, false);
        this.playerId = result.player.id;
        return result.player;
    }
    async list() {
        return this.request("/v1/decks");
    }
    async create(input) {
        const result = await this.request("/v1/decks", { method: "POST", body: JSON.stringify(input) });
        return result.deck;
    }
    async update(id, expectedRevision, input) {
        const result = await this.request(`/v1/decks/${encodeURIComponent(id)}`, {
            method: "PUT",
            body: JSON.stringify({ expected_revision: expectedRevision, ...input }),
        });
        return result.deck;
    }
    async remove(id, expectedRevision) {
        await this.request(`/v1/decks/${encodeURIComponent(id)}`, {
            method: "DELETE",
            body: JSON.stringify({ expected_revision: expectedRevision }),
        });
    }
    async reorder(deckIds) {
        const result = await this.request("/v1/deck-order", {
            method: "PUT",
            body: JSON.stringify({ deck_ids: deckIds }),
        });
        return result.decks;
    }
    async importBrowserDecks(records) {
        return this.request("/v1/imports/browser-decks", {
            method: "POST",
            body: JSON.stringify({ records }),
        });
    }
    async listProgramRecipes(cardId) {
        const query = cardId ? `?card_id=${encodeURIComponent(cardId)}` : "";
        return this.request(`/v1/program-recipes${query}`);
    }
    async createProgramRecipe(input) {
        return this.request("/v1/program-recipes", {
            method: "POST",
            body: JSON.stringify(input),
        });
    }
    async selectProgramRecipe(cardId, recipeId) {
        const result = await this.request(`/v1/program-recipe-preferences/${encodeURIComponent(cardId)}`, {
            method: "PUT",
            body: JSON.stringify({ recipe_id: recipeId }),
        });
        return result.preference;
    }
    async removeProgramRecipe(recipeId) {
        await this.request(`/v1/program-recipes/${encodeURIComponent(recipeId)}`, { method: "DELETE" });
    }
    async shareProgramRecipe(recipeId) {
        return this.request(`/v1/program-recipes/${encodeURIComponent(recipeId)}/share`, { method: "POST" });
    }
    async listSharedProgramRecipes(cardId) {
        const result = await this.request(`/v1/shared-program-recipes?card_id=${encodeURIComponent(cardId)}`);
        return result.shared_recipes;
    }
    async saveSharedProgramRecipe(sharedId) {
        return this.request(`/v1/shared-program-recipes/${encodeURIComponent(sharedId)}/save`, { method: "POST" });
    }
    async unshareProgramRecipe(sharedId) {
        await this.request(`/v1/shared-program-recipes/${encodeURIComponent(sharedId)}`, { method: "DELETE" });
    }
}
