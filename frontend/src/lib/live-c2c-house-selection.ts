export function initialLiveC2CHouseId(
  houses: readonly { id: number }[],
): number | null {
  return houses.length === 1 ? houses[0].id : null;
}
