import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [".next/**", "node_modules/**", "out/**", "dist/**"],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Existing responsive/profile-image layouts rely on native img behavior.
    // Keeping it avoids visual changes while remote upload URLs are proxied.
    rules: { "@next/next/no-img-element": "off" },
  },
];

export default eslintConfig;
