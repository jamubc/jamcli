const square = (x: number) => x * x;
function half(x: number) {
  return x / 2;
}

export const add = (x: number, y: number) => x + y;
export const subtract = (x: number, y: number) => x - y;
export function multiply(x: number, y: number) {
  return x * y;
}
export function divide(x: number, y: number) {
  return x / y;
}
export const hypot = (x: number, y: number) => Math.sqrt(square(x) + square(y));
export const mean = (x: number, y: number) => half(x + y);
export function negate(x: number) {
  return -x;
}
export const PI_ISH = 3.14;
