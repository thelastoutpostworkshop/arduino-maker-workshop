import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: [
      "out/**",
      "dist/**",
      "**/dist/**",
      "**/*.d.ts"
    ]
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2015,
      sourceType: "module",
      parser: tsParser
    },
    plugins: {
      "@typescript-eslint": tseslint
    },
    rules: {
      "@typescript-eslint/naming-convention": [
        "warn",
        {
          selector: "import",
          format: ["camelCase", "PascalCase"]
        }
      ],
      curly: "warn",
      eqeqeq: "warn",
      "no-throw-literal": "warn",
      semi: "warn"
    }
  }
];
