/* tslint:disable */
/* eslint-disable */

export class DkgParticipant {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Create a new DKG participant identified by `identifier_hex` (32-byte
     * FROST identifier). `max_signers` = N (total parties), `min_signers`
     * = T (threshold). Both must match every other participant's values
     * exactly; differing parameters will cause part3 to fail.
     */
    constructor(identifier_hex: string, max_signers: number, min_signers: number);
    /**
     * Round 1 / part1: generate our contribution.
     *
     * Returns a JSON string containing our `round1::Package` (commitment
     * vector + proof-of-knowledge). **Broadcast this verbatim to every
     * other participant over an authenticated channel.**
     */
    round1(): string;
    /**
     * Round 2 / part2: verify everyone else's round1 proof-of-knowledge,
     * evaluate our secret polynomial at each other party's identifier,
     * and produce one confidential package per recipient.
     *
     * `round1_packages_json` is a JSON object
     * `{ "<other_id_hex>": <round1_package_json>, ... }` containing the
     * round1 packages from *all other* participants (not ours; exactly
     * `max_signers - 1` entries).
     *
     * Returns a JSON object
     * `{ "<recipient_id_hex>": <round2_package_json>, ... }`. Each entry
     * **must be sent P2P over a confidential channel** to the party
     * whose identifier is the key. Do not broadcast.
     */
    round2(round1_packages_json: string): string;
    /**
     * Round 3 / part3: verify everyone's round2 share and derive our
     * final key package + the group public key package.
     *
     * `round2_packages_json` is a JSON object
     * `{ "<sender_id_hex>": <round2_package_json>, ... }` containing the
     * round2 packages *addressed to us* from every other participant
     * (exactly `max_signers - 1` entries).
     *
     * Returns JSON `{ share: {...}, public_key_package: {...} }` matching
     * the schema produced by `keygen_with_dealer` so downstream FROST
     * signing code is source-agnostic.
     */
    round3(round2_packages_json: string): string;
    /**
     * Debug-only accessor — returns our identifier hex.
     */
    readonly identifier: string;
}

/**
 * Aggregate signature shares into a 64-byte RedPallas signature.
 */
export function aggregate(commitments_json: string, message_hex: string, sig_shares_json: string, signer_pubkeys_json: string, group_public_hex: string, randomizer_hex: string): string;

/**
 * Build an Orchard-only UFVK string (mainnet) from the FROST group_public
 * and the 64-byte orchard extras (nk || rivk).
 */
export function build_orchard_ufvk_from_frost(group_public_hex: string, orchard_extras_hex: string): string;

/**
 * Build an Orchard-only unified address (mainnet) at diversifier index 0
 * (External scope) from the FROST group_public + orchard extras.
 */
export function build_orchard_unified_address_from_frost(group_public_hex: string, orchard_extras_hex: string): string;

/**
 * Generate nonces + commitments for this participant.
 * Returns JSON: `{ nonces_opaque: hex, commitments: hex_64bytes }`
 * `nonces_opaque` is an internal representation that must be passed to `sign_share`.
 */
export function commit_nonces(secret_share_hex: string): string;

/**
 * Generate a random 32-byte scalar suitable for use as a FROST randomizer.
 */
export function generate_randomizer(): string;

/**
 * Return the group verifying key as hex.
 */
export function get_group_verifying_key(group_public_hex: string): string;

/**
 * Generate key shares using a trusted dealer.
 * Returns JSON with hex-encoded 32-byte scalars/points.
 */
export function keygen_with_dealer(max_signers: number, min_signers: number): string;

/**
 * Merge an existing (seed-derived) UFVK with a FROST-derived Orchard FVK.
 *
 * Takes the caller's seed-derived UFVK string (which typically carries
 * Sapling / P2pkh receivers, and possibly a seed-derived Orchard receiver
 * that we need to replace) and swaps in an Orchard FVK built from the
 * FROST `group_public` (as `ak`) + `orchard_extras` (nk‖rivk). The non-
 * Orchard receivers are preserved verbatim so existing Sapling and
 * transparent notes stay scannable and the resulting UA is the same
 * length / format that users / exchanges expect.
 */
export function merge_seed_ufvk_with_frost_orchard(seed_ufvk: string, group_public_hex: string, orchard_extras_hex: string): string;

/**
 * Merge an existing (seed-derived) unified address with a FROST-derived
 * Orchard receiver. Preserves any Sapling / P2pkh receivers from the seed
 * UA so the combined UA scans / receives to the same Sapling + transparent
 * slots as before, while Orchard spends route through FROST.
 */
export function merge_seed_unified_address_with_frost_orchard(seed_unified_address: string, group_public_hex: string, orchard_extras_hex: string): string;

/**
 * Generate random 64-byte Orchard extras (nk || rivk) that are valid when
 * concatenated with the given FROST group_public (ak) to form a full
 * 96-byte Orchard FVK. Retries until the combined FVK parses successfully.
 *
 * Returns hex-encoded 64 bytes (nk‖rivk) — the caller should persist this
 * alongside the FROST key bundle and reuse it for all subsequent UFVK /
 * unified-address derivations so the Orchard scanning wallet stays stable.
 */
export function orchard_random_extras(group_public_hex: string): string;

/**
 * Produce a rerandomised FROST signature share.
 * This MUST be called immediately after `commit_nonces` — nonces cannot
 * be persisted or reconstructed across calls.
 *
 * `all_commitments_json`: `{ "id_hex": "commit_hex_64bytes", ... }`
 */
export function sign_share(identifier_hex: string, secret_share_hex: string, public_hex: string, group_public_hex: string, all_commitments_json: string, message_hex: string, randomizer_hex: string): string;

/**
 * Produce a rerandomised FROST signature share using pre-committed nonces.
 *
 * Unlike `sign_share`, this does NOT regenerate nonces. It uses the nonces
 * returned by `commit_nonces` (the `nonces_opaque` 128-char hex string).
 * This is required for multi-party signing where both parties must build
 * identical signing packages from exchanged commitments.
 *
 * `nonces_opaque_hex`: 64-byte (128-char) hex — hiding‖binding nonces from `commit_nonces`.
 * `all_commitments_json`: `{ "id_hex": "commit_hex_64bytes", ... }` — MUST use the
 *   commitments from each party's `commit_nonces`, NOT from `sign_share`.
 */
export function sign_with_nonces(identifier_hex: string, secret_share_hex: string, public_hex: string, group_public_hex: string, nonces_opaque_hex: string, all_commitments_json: string, message_hex: string, randomizer_hex: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly keygen_with_dealer: (a: number, b: number) => [number, number, number, number];
    readonly commit_nonces: (a: number, b: number) => [number, number, number, number];
    readonly sign_share: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number) => [number, number, number, number];
    readonly sign_with_nonces: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number) => [number, number, number, number];
    readonly generate_randomizer: () => [number, number, number, number];
    readonly aggregate: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number, number, number];
    readonly get_group_verifying_key: (a: number, b: number) => [number, number, number, number];
    readonly build_orchard_ufvk_from_frost: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly build_orchard_unified_address_from_frost: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly merge_seed_ufvk_with_frost_orchard: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly merge_seed_unified_address_with_frost_orchard: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly orchard_random_extras: (a: number, b: number) => [number, number, number, number];
    readonly __wbg_dkgparticipant_free: (a: number, b: number) => void;
    readonly dkgparticipant_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly dkgparticipant_round1: (a: number) => [number, number, number, number];
    readonly dkgparticipant_round2: (a: number, b: number, c: number) => [number, number, number, number];
    readonly dkgparticipant_round3: (a: number, b: number, c: number) => [number, number, number, number];
    readonly dkgparticipant_identifier: (a: number) => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
