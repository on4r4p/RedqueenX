#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const [, , scriptName, separator, ...commandParts] = process.argv;

if (!scriptName || separator !== "--" || commandParts.length === 0) {
  console.error("Usage: node scripts/session-command.cjs <npm-script> -- <command> [args...]");
  process.exit(64);
}

const command = commandParts[0];
const commandArgs = commandParts.slice(1);
const startedAt = Date.now();
const sessionFile = currentSessionFilePath();
const outputBuffer = {
  stdout: "",
  stderr: ""
};

record("INFO", "npm.script.started", `npm run ${scriptName} started`, {
  script: scriptName,
  pid: process.pid,
  ppid: process.ppid,
  cwd: process.cwd(),
  host: os.hostname(),
  command,
  args: redactArgs(commandArgs)
});

const child = spawn(command, commandArgs, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    REDQUEENX_ORIGINAL_NPM_COMMAND: originalNpmCommand(scriptName, commandArgs)
  },
  stdio: ["inherit", "pipe", "pipe"]
});

child.stdout?.on("data", (chunk) => {
  process.stdout.write(chunk);
  appendOutput("stdout", chunk);
});

child.stderr?.on("data", (chunk) => {
  process.stderr.write(chunk);
  appendOutput("stderr", chunk);
});

let forwardedSignal = null;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    forwardedSignal = signal;
    if (!child.killed) {
      child.kill(signal);
    }
  });
}

child.on("error", (error) => {
  record("PROB", "npm.script.failed", `npm run ${scriptName} failed to start`, {
    script: scriptName,
    pid: process.pid,
    command,
    args: redactArgs(commandArgs),
    error: error.message,
    durationMs: Date.now() - startedAt
  });
  process.exit(1);
});

child.on("exit", (code, signal) => {
  const durationMs = Date.now() - startedAt;
  const effectiveSignal = signal || forwardedSignal;
  if (code === 0 && !effectiveSignal) {
    record("INFO", "npm.script.completed", `npm run ${scriptName} completed`, {
      script: scriptName,
      pid: process.pid,
      exitCode: code,
      durationMs
    });
    process.exit(0);
  }

  if (effectiveSignal) {
    record("PROB", "npm.script.interrupted", `npm run ${scriptName} interrupted`, {
      script: scriptName,
      pid: process.pid,
      signal: effectiveSignal,
      exitCode: code,
      durationMs,
      stdoutTail: outputTail(outputBuffer.stdout),
      stderrTail: outputTail(outputBuffer.stderr)
    });
    process.exit(128 + signalNumber(effectiveSignal));
  }

  record("PROB", "npm.script.failed", `npm run ${scriptName} failed`, {
    script: scriptName,
    pid: process.pid,
    exitCode: code,
    durationMs,
    stdoutTail: outputTail(outputBuffer.stdout),
    stderrTail: outputTail(outputBuffer.stderr)
  });
  process.exit(code ?? 1);
});

function appendOutput(stream, chunk) {
  outputBuffer[stream] += redactOutput(String(chunk));
  if (outputBuffer[stream].length > 12_000) {
    outputBuffer[stream] = outputBuffer[stream].slice(-12_000);
  }
}

function outputTail(text) {
  const cleaned = text.trimEnd();
  if (!cleaned) return "";
  return cleaned.split(/\r?\n/).slice(-40).join("\n");
}

function currentSessionFilePath() {
  const envFileValue = readEnvValue("CURRENT_SESSION_FILE");
  const configured = process.env.CURRENT_SESSION_FILE || envFileValue || "./runtime/current-session.log";
  return path.resolve(configured);
}

function readEnvValue(key) {
  const envPath = path.resolve(".env");
  if (!fs.existsSync(envPath)) return "";
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals === -1) continue;
    const name = trimmed.slice(0, equals).trim();
    if (name !== key) continue;
    return unquote(trimmed.slice(equals + 1).trim());
  }
  return "";
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function record(level, type, message, data) {
  try {
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.appendFileSync(
      sessionFile,
      `[${new Date().toISOString()}] ${level} ${type} ${message} ${JSON.stringify(data)}\n`,
      "utf8"
    );
  } catch {
    // A broken session log must never block the actual npm command.
  }
}

function redactArgs(args) {
  const sensitiveFlag = /password|secret|token|auth|cookie|session/i;
  return args.map((arg, index) => {
    const previous = args[index - 1] || "";
    if (sensitiveFlag.test(previous)) return "***";
    if (sensitiveFlag.test(arg)) return arg.replace(/=.*/, "=***");
    return arg;
  });
}

function redactOutput(text) {
  return text
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g, "[redacted-github-token]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[redacted-github-token]")
    .replace(/\bsk-[A-Za-z0-9_-]{24,}\b/g, "[redacted-api-key]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, "[redacted-slack-token]")
    .replace(/(password|secret|token|cookie|authorization)(["'\s:=]+)([^"'\s,}]+)/gi, "$1$2[redacted]");
}

function originalNpmCommand(script, args) {
  const passthrough = passthroughArgs(script, args);
  return passthrough.length > 0 ? `npm run ${script} -- ${passthrough.join(" ")}` : `npm run ${script}`;
}

function passthroughArgs(script, args) {
  if (script === "netns:x-login") {
    const separator = args.lastIndexOf("--");
    return separator >= 0 ? args.slice(separator + 1) : [];
  }
  return [];
}

function signalNumber(signal) {
  const numbers = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGTERM: 15
  };
  return numbers[signal] || 1;
}
