import type { TimePairParseError } from '../../../../common/features/patchTimeConvert';

/** The slice of i18next's `t` these messages need. */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
The user-facing message of one parse problem (pure formatting, translated by the caller).

`timeRange` is the one that needs the field: `012366` is not "invalid", it is a seconds value that
cannot exist, and saying which part is wrong lets the user fix the line without thinking. (The
legacy reader would have silently rolled those 66 seconds into the next minute.)
*/
export function describeTimePairError(t: Translate, error: TimePairParseError, maxLabelLength: number): string {
  switch (error.code) {
    case 'shortTime': {
      return t('A bare number needs at least 6 digits (HHMMSS). Write H:M:S or seconds with a decimal point for a shorter time.');
    }
    case 'timeRange': {
      return error.field === 'minutes'
        ? t('The minutes must be 0-59 (this says {{value}}).', { value: error.value ?? '' })
        : t('The seconds must be 0-59 (this says {{value}}).', { value: error.value ?? '' });
    }
    case 'invalidTime': {
      return t('Not a time: {{token}}', { token: error.token ?? '' });
    }
    case 'missingEnd': {
      return t('A cut needs a start and an end time.');
    }
    case 'endNotAfterStart': {
      return t('The end must be later than the start.');
    }
    case 'labelTooLong': {
      return t('The label is too long ({{max}} characters at most).', { max: maxLabelLength });
    }
    case 'multipleVideos': {
      return t('The text names more than one video ({{names}}). Convert one video at a time.', { names: error.token ?? '' });
    }
    default: {
      return t('This line could not be read.');
    }
  }
}
