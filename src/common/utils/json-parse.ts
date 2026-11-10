export const jsonParse = <Result>(text: string): Result | null => {
  try {
    return JSON.parse(text || '') as Result;
  } catch {
    return null;
  }
};
