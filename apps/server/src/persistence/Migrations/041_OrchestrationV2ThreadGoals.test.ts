import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("041_OrchestrationV2ThreadGoals", (it) => {
  it.effect("adds nullable goal storage after the scheduled-task migration", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 41 });
      const before = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(orchestration_v2_projection_threads)
      `;
      assert.isFalse(before.some((column) => column.name === "goal_payload_json"));
      assert.isFalse(before.some((column) => column.name === "goal_revision_payload_json"));

      yield* runMigrations({ toMigrationInclusive: 42 });
      const after = yield* sql<{
        readonly name: string;
        readonly is_not_null: number;
        readonly dflt_value: string | null;
      }>`
        SELECT name, "notnull" AS is_not_null, dflt_value
        FROM pragma_table_info('orchestration_v2_projection_threads')
        WHERE name IN ('goal_payload_json', 'goal_revision_payload_json')
        ORDER BY name
      `;
      assert.deepStrictEqual(after, [
        {
          name: "goal_payload_json",
          is_not_null: 0,
          dflt_value: null,
        },
        {
          name: "goal_revision_payload_json",
          is_not_null: 0,
          dflt_value: null,
        },
      ]);
    }),
  );
});
