#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadProfile } from "./config/profile.js";
import { isWritesAllowed } from "./config/settings.js";
import { buildServer } from "./server.js";

const profile = loadProfile({ env: process.env, readFile: (path) => readFileSync(path, "utf-8") });
const server = buildServer(profile, isWritesAllowed(process.env));

await server.connect(new StdioServerTransport());
