const titleizeWord = string => (
  string.charAt(0).toUpperCase() + string.slice(1).toLowerCase()
);

export default function titleize(sentence) {
  return sentence.split(/[ _-]+/).map(titleizeWord).join(' ');
}
