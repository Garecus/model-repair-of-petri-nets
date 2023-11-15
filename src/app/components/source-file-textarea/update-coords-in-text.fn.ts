//todo
export function removeCoordinates(value: string): string {
  const contentLines = value.split('\n');
  let newText = '';
  let first = true;
  for (const line of contentLines) {
    if (first) {
      newText = newText + line.split('[')[0];
      first = false;
    } else {
      newText = `${newText}\n${line.split('[')[0].trim()}`;
    }
  }
  return newText;
}
