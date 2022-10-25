import { readFileSync } from "fs";
import ohm from "ohm-js";


const grammar = ohm.grammar(readFileSync('src/assets/grammar.ohm', 'utf-8'));
const semantics = grammar.createSemantics();
semantics.addOperation('eval()', {
    Main(cards, eof) {
        const out = cards.children.map((card) => {
            return card.eval();
        });
        return out;
    },

    Flashcard(quesiton, flashcard_tag, newline, answer, anki_id) {
        return {
            question: quesiton.sourceString,
            answer: answer.sourceString,
            anki_id: anki_id.sourceString || null,
        };
    },


    F_id(_, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13) {
        // Concatenate all the digits and return the source string
        const digits = [d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13].map(d => d.sourceString).join('');
        // Convert to a number
        return parseInt(digits, 10);
    },

    // OBSIDIAN SYNTAX
    Tag(hashtag, letter, alnums) {
        return hashtag.sourceString + letter.sourceString + alnums.sourceString;
    }
});


const markdownFile = readFileSync('src/assets/note.md', 'utf-8');

const m = grammar.match(markdownFile);
if (m.succeeded()) {
    console.log('\x1b[32m%s\x1b[0m', "Parsed successfully.");
} else {
    console.log('\x1b[31m%s\x1b[0m', "Could not parse.");
}

const result = semantics(m).eval();
console.log("The final result is: ")
console.log(result);
