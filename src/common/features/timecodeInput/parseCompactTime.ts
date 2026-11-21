/* eslint-disable import/prefer-default-export */
/**
The fork's compact time input, written with a `..` prefix (fork-owned, see the renderer's
`features/timecodeInput`).

The two dots say "this is a time of day, not a number of seconds", so the plain numbers of the
upstream parser keep their meaning (`123456` stays 123456 seconds). Two shapes share the prefix:

- No separators: positional `HHMMSSfff`. Input shorter than 6 digits is padded at the front and 6
  to 8 digits at the back, so single digits are padded by the user by hand (`..12345` is 01:23:45,
  `..1234567` is 12:34:56.700).
- With separators (`.` or `:`): the separators only group the digits; they carry no meaning of
  their own. Every field is read 2 digits at a time and the values are the usual ladder counted
  from the right (seconds, minutes, hours, milliseconds), so the padding may be left out
  (`..1.2.3` is 01:02:03). `:` works as well but is the discouraged form.

A trailing separator is a keyboard habit ("..012228." while typing the fraction): it is ignored,
so the value it stands for does not change (`..012228.` is 01:22:28.000).
*/

const compactTimeRegex = /^\.\.(\d+(?:[.:]\d+)*)[.:]?$/;

/** Build seconds from the parsed values, rejecting the values that cannot be a time of day. */
function toSeconds({ hours, minutes, seconds, milliseconds }: {
  hours: number,
  minutes: number,
  seconds: number,
  milliseconds: number,
}) {
  if (minutes > 59 || seconds > 59) return undefined;
  return (((hours * 60) + minutes) * 60) + seconds + (milliseconds / 1000);
}

/** Positional `HHMMSSfff`: short input padded at the front, 6 to 8 digits at the back. */
function parsePositional(digits: string) {
  if (digits.length > 9) return undefined;

  const padded = digits.length < 6 ? digits.padStart(6, '0') : digits.padEnd(9, '0');

  return toSeconds({
    hours: Number(padded.slice(0, 2)),
    minutes: Number(padded.slice(2, 4)),
    seconds: Number(padded.slice(4, 6)),
    milliseconds: Number(padded.slice(6, 9)),
  });
}

/**
The values of one field: 2 digits at a time. The last field of all is allowed to hold 1 to 3
digits as a single value, so that a milliseconds value may be written without padding.
*/
function fieldValues(field: string, isLast: boolean) {
  if (isLast && field.length <= 3) return [field];

  const values: string[] = [];
  for (let index = 0; index < field.length; index += 2) values.push(field.slice(index, index + 2));
  return values;
}

/** The ladder counted from the right: seconds, minutes, hours, then milliseconds. */
function parseSeparated(fields: string[]) {
  const values = fields.flatMap((field, index) => fieldValues(field, index === fields.length - 1));

  if (values.length === 0 || values.length > 4) return undefined;

  if (values.length === 1) {
    return toSeconds({ hours: 0, minutes: 0, seconds: Number(values[0]), milliseconds: 0 });
  }
  if (values.length === 2) {
    return toSeconds({ hours: 0, minutes: Number(values[0]), seconds: Number(values[1]), milliseconds: 0 });
  }
  if (values.length === 3) {
    return toSeconds({ hours: Number(values[0]), minutes: Number(values[1]), seconds: Number(values[2]), milliseconds: 0 });
  }
  return toSeconds({
    hours: Number(values[0]),
    minutes: Number(values[1]),
    seconds: Number(values[2]),
    milliseconds: Number(values[3]!.padEnd(3, '0')),
  });
}

/** Parse a `..` compact time into seconds, or `undefined` when the string is not one. */
export function parseCompactTimeInput(raw: string): number | undefined {
  // The trailing separator is outside the captured group, so it is dropped here.
  const match = compactTimeRegex.exec(raw.replaceAll(/\s/g, ''));
  if (match == null) return undefined;

  const body = match[1]!;
  if (body.includes('.') || body.includes(':')) return parseSeparated(body.split(/[.:]/));
  return parsePositional(body);
}
