export function getMyBenefit() {
  return fetch('http://localhost:3000/api/benefits/me');
}
