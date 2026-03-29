/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  transform: {
    '^.+\\.tsx?$': ['@swc/jest'],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  setupFilesAfterEnv: ['<rootDir>/src/jest-setup.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  transformIgnorePatterns: [
    '/node_modules/(?!(@grafana|d3-interpolate|d3-color|internmap|d3-scale|d3-format|d3-time|d3-time-format|d3-array|ol|geotiff|quick-lru|react-markdown|remark-.*|rehype-.*|mdast-util-.*|micromark.*|unist-util-.*|unified|bail|trough|vfile.*|devlop|property-information|hast-util-.*|space-separated-tokens|comma-separated-tokens|estree-util-.*|ccount|escape-string-regexp|markdown-table|longest-streak|zwitch|html-void-elements|web-namespaces|stringify-entities|character-entities.*|is-plain-obj|trim-lines|parse5|direction|decode-named-character-reference|character-reference-invalid|is-decimal|is-hexadecimal|is-alphanumerical|is-alphabetical)/)',
  ],
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': '<rootDir>/src/__mocks__/styleMock.js',
    '\\.(gif|ttf|eot|svg|png)$': '<rootDir>/src/__mocks__/fileMock.js',
    '^react-markdown$': '<rootDir>/src/__mocks__/react-markdown.js',
    '^remark-gfm$': '<rootDir>/src/__mocks__/remark-gfm.js',
    '^rehype-raw$': '<rootDir>/src/__mocks__/rehype-raw.js',
    '^rehype-sanitize$': '<rootDir>/src/__mocks__/rehype-sanitize.js',
  },
};
