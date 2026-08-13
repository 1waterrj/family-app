const { run } = require('jest');

const argumentsWithoutPnpmSeparator = process.argv
  .slice(2)
  .filter((argument) => argument !== '--');

void run(argumentsWithoutPnpmSeparator);
