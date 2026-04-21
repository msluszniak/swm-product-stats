export const SWM_ORG = 'software-mansion';
export const SWM_LABS_ORG = 'software-mansion-labs';

// Non-SWM dependents filter checks against all of these.
export const SWM_ORGS = [SWM_ORG, SWM_LABS_ORG];

export const GITHUB_REPOS: { owner: string; repo: string }[] = [
  { owner: SWM_ORG, repo: 'react-native-executorch' },
  { owner: SWM_LABS_ORG, repo: 'react-native-rag' },
  { owner: SWM_LABS_ORG, repo: 'private-mind' },
];

export const NPM_PACKAGES: string[] = [
  'react-native-executorch',
  'react-native-executorch-expo-resource-fetcher',
  'react-native-executorch-bare-resource-fetcher',
  'react-native-rag',
];

export const HF_AUTHOR = SWM_ORG;

export const DEPENDENTS_REPO = { owner: SWM_ORG, repo: 'react-native-executorch' };

export const DEPENDENTS_MAX_PAGES = 5;

export const REPO_URL =
  process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}`
    : 'https://github.com/msluszniak/swm-product-stats';
