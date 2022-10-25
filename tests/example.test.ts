import {describe, expect, test} from '@jest/globals';
import {readFileSync} from 'fs';


const file = readFileSync('test/obsidian_test_vault/Parse_correctly_all_flashcards.md', 'utf8');

describe('sum module', () => {
  test('adds 1 + 2 to equal 3', () => {
    // TODO: define a json output for the parsing of the file and then match it
    expect(2+1).toBe(3);
  });
});