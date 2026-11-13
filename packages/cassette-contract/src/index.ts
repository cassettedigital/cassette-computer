/**
 * @discovery/cassette-contract
 *
 * One authoritative, typed definition of the Cassette client <-> cassette.digital
 * sync contract (wire/snake_case), plus the cross-language cassette_local_id
 * hash fixture + normalization spec, plus the shared Popular-songs ranking rule.
 *
 * - `./sync`          — over-the-wire request/response DTOs for /api/sync/*
 * - `./local-id`      — the hash fixture, divergence record, and pipeline spec
 * - `./popular-songs` — Popular list ordering + caps (web/iOS/Android must match)
 */

export * from "./sync";
export * from "./local-id";
export * from "./popular-songs";
