const colors = [
  '#F5C012',
  '#83DD87',
  '#00C7B7',
  '#7E9DF2',
  '#587CCC',
  '#FF9750',
  '#FC876D',
  '#AB7ECE',
];

export default name => (
  colors[
    Array.from(name).map(e => e.charCodeAt(0)).reduce((acc, code) => acc + code) % colors.length
  ]
);
