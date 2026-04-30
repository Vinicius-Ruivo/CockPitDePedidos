// @ts-check
// Configuração flat do ESLint 9 usada pelo pcf-scripts.
//
// Este arquivo existe para quando você quiser REATIVAR o lint no build:
//   1. No pcfconfig.json, remova (ou coloque como false) o campo "skipBuildLinting".
//   2. Instale os plugins necessários (uma única vez):
//        npm install --save-dev typescript-eslint eslint-plugin-react eslint-plugin-react-hooks
//   3. Rode `npm start` normalmente.
//
// Enquanto os plugins acima não estiverem instalados, mantenha
// "skipBuildLinting": true no pcfconfig.json — o pcf-scripts
// simplesmente vai pular o ESLint sem quebrar o build.

import js from "@eslint/js";
import globals from "globals";

// Tentamos carregar typescript-eslint de forma tolerante: se não estiver
// instalado, caímos num array vazio e só os checks JS básicos ficam ativos.
let tseslint = null;
try {
    tseslint = (await import("typescript-eslint")).default;
} catch {
    // typescript-eslint ainda não foi instalado — sem problema, seguimos só com JS.
}

// eslint-plugin-react também é opcional.
let reactPlugin = null;
let reactHooksPlugin = null;
try {
    reactPlugin = (await import("eslint-plugin-react")).default;
} catch {
    // plugin react ainda não instalado — ignoramos regras específicas de react.
}
try {
    reactHooksPlugin = (await import("eslint-plugin-react-hooks")).default;
} catch {
    // plugin react-hooks ainda não instalado — ignoramos regras hooks.
}

const baseIgnores = {
    ignores: [
        "node_modules/**",
        "out/**",
        "generated/**",
        "**/*.d.ts",
        "**/bundle.js",
    ],
};

const jsRecommended = {
    ...js.configs.recommended,
    languageOptions: {
        ...(js.configs.recommended.languageOptions ?? {}),
        globals: {
            ...(globals?.browser ?? {}),
            ...(globals?.node ?? {}),
        },
    },
};

const tsConfigs = tseslint
    ? tseslint.configs.recommended.map((cfg) => ({
          ...cfg,
          files: ["**/*.ts", "**/*.tsx"],
      }))
    : [];

const reactConfig = reactPlugin
    ? {
          files: ["**/*.tsx", "**/*.jsx"],
          plugins: {
              react: reactPlugin,
              ...(reactHooksPlugin ? { "react-hooks": reactHooksPlugin } : {}),
          },
          settings: { react: { version: "detect" } },
          rules: {
              ...(reactPlugin.configs?.recommended?.rules ?? {}),
              ...(reactHooksPlugin?.configs?.recommended?.rules ?? {}),
              "react/react-in-jsx-scope": "off",
              "react/prop-types": "off",
          },
      }
    : null;

const projectOverrides = {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
        "no-unused-vars": "off",
        "no-empty": ["warn", { allowEmptyCatch: true }],
    },
};

export default [
    baseIgnores,
    jsRecommended,
    ...tsConfigs,
    ...(reactConfig ? [reactConfig] : []),
    projectOverrides,
];
