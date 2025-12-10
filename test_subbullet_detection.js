// Test if the regex correctly detects sub-bullets

const testCases = [
  {
    name: "Ends with sub-bullet",
    text: "Systole:\n   - Aortic valve opens\n   - Blood ejected",
  },
  {
    name: "Regular bullet point",
    text: "Systole is the contraction phase",
  },
  {
    name: "Has sub-bullets but not at end",
    text: "Systole:\n   - Aortic valve opens\nFollowed by text",
  },
];

testCases.forEach(test => {
  const hasSubBullets = /\n\s+-\s[^\n]*$/.test(test.text);
  console.log(`\n${test.name}:`);
  console.log(`Text: "${test.text}"`);
  console.log(`Has sub-bullets at end: ${hasSubBullets}`);
});
