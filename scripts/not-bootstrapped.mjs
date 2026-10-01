const command = process.argv[2] ?? "command";

console.error(
  `The application workspace has not been bootstrapped yet; '${command}' is documented but unavailable. ` +
    "Implement the Phase 1 vertical slice and replace this placeholder script."
);

process.exitCode = 1;

