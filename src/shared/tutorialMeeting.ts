export const TUTORIAL_MEETING_ID = 'mineloa-tutorial-ami-es2004a'
export const TUTORIAL_ATTRIBUTION = 'Source: AMI Meeting Corpus, ES2004a, 12:35–16:20. © AMI Consortium. CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Original: https://groups.inf.ed.ac.uk/ami/corpus/. Changes: audio excerpt converted to mono Opus; transcript grouped into utterances; tutorial summary written by Mineloa.'
export const TUTORIAL_SOURCE_URL = 'https://groups.inf.ed.ac.uk/ami/corpus/'
export const TUTORIAL_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/'
export function isTutorialExternalUrl(url: string): boolean {
  return url === TUTORIAL_SOURCE_URL || url === TUTORIAL_LICENSE_URL
}
