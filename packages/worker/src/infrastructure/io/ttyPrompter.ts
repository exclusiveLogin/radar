import * as readline from "node:readline";

export type TtyPrompter = {
  ask: (question: string) => Promise<string>;
  close: () => void;
};export function createTtyPrompter(): TtyPrompter {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return {
    ask: (question) =>
      new Promise((resolve) => {
        rl.question(question, (answer) => resolve(answer.trim()));
      }),
    close: () => rl.close(),
  };
}
