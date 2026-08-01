// framer-motion ships type declarations in its published package, but the installed copy in this
// environment is missing dist/*.d.ts entirely (confirmed not a general install problem or a
// package.json/exports resolution issue like @xyflow/react below - other packages, including
// @xyflow/react's own .d.ts files, are genuinely present and correctly resolved). Shimmed here per
// TypeScript's own suggested remediation for a module with no usable declaration file.
declare module "framer-motion";
