import {VM} from 'vm2';

export interface StepContext {
  output: unknown;
  status: string;
}

export interface ScriptInput {
  input: Record<string, unknown>;
  globals: Record<string, unknown>;
  context: {
    steps: Record<string, StepContext>;
    previousStep: StepContext | null;
  };
}

export interface ScriptOutput {
  result: unknown;
  logs: string[];
}

const SCRIPT_TIMEOUT_MS = 5_000;

export function executeScript(
  script: string,
  scriptInput: ScriptInput,
): ScriptOutput {
  const logs: string[] = [];

  const vm = new VM({
    timeout: SCRIPT_TIMEOUT_MS,
    allowAsync: false,
    sandbox: {
      input: scriptInput.input,
      globals: scriptInput.globals,
      context: scriptInput.context,
      console: {
        log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
        error: (...args: unknown[]) =>
          logs.push('[kesalahan] ' + args.map(String).join(' ')),
        warn: (...args: unknown[]) =>
          logs.push('[peringatan] ' + args.map(String).join(' ')),
      },
      Math,
      JSON,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
    },
  });

  const wrapped = `(function() { ${script} })()`;
  const result = vm.run(wrapped);

  return {result: result ?? null, logs};
}
