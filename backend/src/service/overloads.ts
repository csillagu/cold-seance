/**
 * The overload detector of the service layer (SC-040, DD-039): a person is overloaded on a day
 * when their load that day is above their capacity that day (FR-042), and only then; a load equal
 * to capacity is no overload. It only marks: nothing is moved because of an overload, in any
 * project (DD-029).
 *
 * The capacity of a day is the person's capacity, or 0 on a day of their absences (FR-151), as
 * the daily person load aggregator (SC-006) gives it.
 */
export function isOverloaded(load: number, capacity: number): boolean {
  return load > capacity
}

/** A person's load and capacity on one day, as the overload detector reads them. */
export interface LoadAndCapacity {
  date: string
  load: number
  capacity: number
}

/** The days, of those given, on which the person is overloaded (FR-042), in the order given. */
export function overloadedDays(days: readonly LoadAndCapacity[]): string[] {
  return days.filter((day) => isOverloaded(day.load, day.capacity)).map((day) => day.date)
}
