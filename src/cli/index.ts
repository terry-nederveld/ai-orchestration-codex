#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { Command } from "commander";
import { loadWorkflow } from "../application/workflows/loader.js";
import { loadFableConfig } from "../composition/config.js";
import { FableRuntime } from "../composition/runtime.js";
import { ControlPlaneServer } from "../control-plane/server.js";
import { initialConfig, initialWorkflow } from "./templates.js";

const program = new Command()
  .name("fable")
  .description("Provider-neutral autonomous software-delivery orchestration")
  .version("0.1.0")
  .option("-c, --config <path>", "configuration file")
  .option("--json", "emit machine-readable JSON", false)
  .showHelpAfterError();

program
  .command("init")
  .description("create a safe starter configuration and workflow")
  .option("-p, --path <path>", "configuration path", "fable.config.yaml")
  .option("--force", "replace existing starter files", false)
  .action(async (options: { path: string; force: boolean }) => {
    const configPath = resolve(options.path);
    const workflowPath = resolve(dirname(configPath), "workflows/software-development.yaml");
    await mkdir(dirname(workflowPath), { recursive: true });
    const flag = options.force ? "w" : "wx";
    await writeFile(configPath, initialConfig, { encoding: "utf8", mode: 0o600, flag });
    await writeFile(workflowPath, initialWorkflow, { encoding: "utf8", mode: 0o600, flag });
    output({ config: configPath, workflow: workflowPath });
  });

program
  .command("validate")
  .description("validate configuration and workflows without contacting providers")
  .argument("[workflow]", "specific workflow path")
  .action(async (workflow?: string) => {
    if (workflow !== undefined) {
      const compiled = await loadWorkflow(resolve(workflow));
      output({
        valid: true,
        workflow: compiled.definition.id,
        steps: compiled.definition.steps.length,
      });
      return;
    }
    const config = await loadFableConfig(globalOptions().config);
    const results = [];
    for (const path of config.value.workflows) {
      const compiled = await loadWorkflow(resolve(config.directory, path), config.directory);
      results.push({ id: compiled.definition.id, steps: compiled.definition.steps.length });
    }
    output({ valid: true, config: config.path, workflows: results });
  });

program
  .command("providers")
  .description("show configured provider capability and availability status")
  .action(async () => {
    await withRuntime(async (runtime) => output({ providers: await runtime.providerStatuses() }));
  });

const work = program.command("work").description("discover work items");
work
  .command("list")
  .requiredOption("-p, --provider <id>", "work provider ID")
  .option("--project <project>")
  .option("--state <state...>")
  .option("--label <label...>")
  .option("--assignee <id>")
  .option("--limit <number>", "maximum items", "50")
  .action(
    async (options: {
      provider: string;
      project?: string;
      state?: string[];
      label?: string[];
      assignee?: string;
      limit: string;
    }) => {
      await withRuntime(async (runtime) => {
        const page = await runtime.discoverWork(options.provider, {
          ...(options.project === undefined ? {} : { project: options.project }),
          ...(options.state === undefined ? {} : { states: options.state }),
          ...(options.label === undefined ? {} : { labels: options.label }),
          ...(options.assignee === undefined ? {} : { assignee: options.assignee }),
          limit: positiveInteger(options.limit, "limit"),
        });
        output(page);
      });
    },
  );

program
  .command("run")
  .description("run one work item to a terminal outcome")
  .requiredOption("-p, --provider <id>", "work provider ID")
  .requiredOption("-i, --issue <id>", "external work-item ID")
  .requiredOption("-w, --workflow <id>", "workflow ID")
  .option("--owner <owner>", "claim owner")
  .action(
    async (options: { provider: string; issue: string; workflow: string; owner?: string }) => {
      await withRuntime(async (runtime) => {
        const result = await runtime.run({
          workProviderId: options.provider,
          externalId: options.issue,
          workflowId: options.workflow,
          ...(options.owner === undefined ? {} : { owner: options.owner }),
        });
        output(result);
        if (result.run.status !== "COMPLETED") process.exitCode = 1;
      });
    },
  );

const runs = program.command("runs").description("inspect and control runs");
runs.command("list").action(async () => {
  await withRuntime(async (runtime) => output({ runs: await runtime.listRuns() }));
});
runs
  .command("show")
  .argument("<run-id>")
  .action(async (runId: string) => {
    await withRuntime(async (runtime) => {
      const run = await runtime.getRun(runId);
      if (run === undefined) throw new Error(`Run not found: ${runId}`);
      output({ run, events: await runtime.eventsForRun(runId) });
    });
  });

const approvals = program.command("approvals").description("inspect and resolve approval gates");
approvals.command("list").action(async () => {
  await withRuntime(async (runtime) => output({ approvals: await runtime.approvals.list() }));
});
approvals
  .command("resolve")
  .argument("<approval-id>")
  .requiredOption("-d, --decision <decision>", "approved or denied")
  .action(async (id: string, options: { decision: string }) => {
    if (options.decision !== "approved" && options.decision !== "denied") {
      throw new Error("Decision must be approved or denied");
    }
    await withRuntime(async (runtime) => {
      output({
        resolved: await runtime.resolveApproval(id, options.decision as "approved" | "denied"),
      });
    });
  });

const secrets = program.command("secrets").description("manage encrypted secret references");
secrets
  .command("set")
  .argument("<reference>")
  .description("read a secret value from stdin and store it without printing it")
  .action(async (reference: string) => {
    const value = (await readStdin()).replace(/\r?\n$/, "");
    if (value.length === 0) throw new Error("Secret value on stdin is empty");
    await withRuntime(async (runtime) => {
      await runtime.secrets.set(reference, value);
      output({ stored: true, reference });
    });
  });
secrets
  .command("delete")
  .argument("<reference>")
  .action(async (reference: string) => {
    await withRuntime(async (runtime) => {
      output({ deleted: await runtime.secrets.delete(reference), reference });
    });
  });

program
  .command("serve")
  .description("start the loopback-only authenticated control plane")
  .option("--host <host>", "loopback bind address", "127.0.0.1")
  .option("--port <port>", "port, or 0 for an ephemeral port", "3210")
  .action(async (options: { host: string; port: string }) => {
    if (!isLoopback(options.host)) throw new Error("Control plane host must be a loopback address");
    const config = await loadFableConfig(globalOptions().config);
    const runtime = await FableRuntime.create(config);
    const server = new ControlPlaneServer(runtime, {
      host: options.host,
      port: nonNegativeInteger(options.port, "port"),
    });
    const address = await server.start();
    process.stdout.write(`${JSON.stringify({ type: "fable.control-plane.ready", ...address })}\n`);
    await waitForShutdown();
    await server.close();
    await runtime.close();
  });

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (globalOptions().json) process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  else process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});

async function withRuntime(operation: (runtime: FableRuntime) => Promise<void>): Promise<void> {
  const runtime = await FableRuntime.create(await loadFableConfig(globalOptions().config));
  try {
    await operation(runtime);
  } finally {
    await runtime.close();
  }
}

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, globalOptions().json ? 0 : 2)}\n`);
}

function globalOptions(): { config?: string; json: boolean } {
  return program.opts<{ config?: string; json: boolean }>();
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function nonNegativeInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function isLoopback(host: string): boolean {
  return ["127.0.0.1", "localhost", "::1"].includes(host);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const rawChunk of process.stdin) {
    const chunk: unknown = rawChunk;
    if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
    else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk));
    else throw new TypeError("Standard input produced an unsupported value");
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function waitForShutdown(): Promise<void> {
  await new Promise<void>((resolveShutdown) => {
    process.once("SIGINT", resolveShutdown);
    process.once("SIGTERM", resolveShutdown);
  });
}
