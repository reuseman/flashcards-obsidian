// const sum = require('./sum');
import * as fs from 'fs';
import * as path from 'path';


describe("Parse single flashcard in one file, default deck", () => {
    test("Flashcard with tag on the line of the question", () => {
        // Read file from test directory
        const file: string = fs.readFileSync(path.join(__dirname, 'obsidian_vault', 'test_flashcard_1.md'), 'utf8');
        // print file
        console.log(file);
        // test that 2 == 1 +1
        expect(2).toBe(1 + 1);
    });
});
