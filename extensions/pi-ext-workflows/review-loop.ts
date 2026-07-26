import { Type, type Static } from "typebox";
import {
  registerWorkflowExtension,
  type JsonValue,
  type WorkflowExtension,
} from "../../../../git/personale/pi-workflows/dist/src/index.js";

const inputSchema = Type.Object(
  {
    task: Type.String(),
    maxIterations: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const reviewLoopExtension: WorkflowExtension = {
  version: "1.0.0",
  headline: "Developer-review loop",
  description:
    "Runs developer and reviewer agents in a loop until review passes.",
  functions: {
    developUntilApproved: {
      description:
        "Run developer and reviewer agents until review passes or the iteration limit is reached",
      input: inputSchema,
      output: Type.Object(
        {
          pass: Type.Boolean(),
          iterations: Type.Integer(),
          devResult: Type.Any(),
          review: Type.Object({}),
        },
        { additionalProperties: false },
      ),
      async run(input, { agent, prompt }) {
        const { task, maxIterations = 5 } = input as unknown as Static<
          typeof inputSchema
        >;
        let devResult: JsonValue = null;
        let review: JsonValue = { pass: false };

        for (let iterations = 1; iterations <= maxIterations; iterations += 1) {
          const devPrompt =
            iterations === 1
              ? prompt("Implement this task:\n\n{task}", { task })
              : prompt(
                  "Address the previous review findings and complete the task.\n\nTask:\n{task}\n\nPrevious review:\n{review}",
                  { task, review },
                );
          devResult = await agent(devPrompt, { role: "developer" });
          review = await agent(
            prompt(
              "Review the implementation against the task. Set pass=true only when the task is complete and correct.\n\nTask:\n{task}\n\nDeveloper result:\n{devResult}",
              { task, devResult },
            ),
            {
              role: "reviewer",
              outputSchema: Type.Object(
                {
                  pass: Type.Boolean(),
                  findings: Type.Array(Type.String()),
                },
                { additionalProperties: false },
              ),
            },
          );

          if ((review as { pass: boolean }).pass)
            return { pass: true, iterations, devResult, review };
        }

        return { pass: false, iterations: maxIterations, devResult, review };
      },
    },
  },
};

export default function (): void {
  registerWorkflowExtension(reviewLoopExtension);
}
