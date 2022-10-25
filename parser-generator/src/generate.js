const fs = require("fs");
const ohm = require("ohm-js");

const file = fs.readFileSync('../assets/grammar.ohm').toString();
const grammar = ohm.grammar(file);
const semantics = grammar.createSemantics();
semantics.addOperation('eval()', {
	Main(cards, eof) {
		const out = cards.children.map((card) => {
			return card.eval();
		});
		return out;
	},

	Flashcard(question, back) {
		return {
			question: question.eval(),
			back: back.eval(),
		};
	},

	questionTagged(question, _tag) {
		return {
			question: question.sourceString,
		}
	},

	backTagged(answer, id) {
		return {
			answer: answer.sourceString,
			id: id.sourceString,
		};
	},

	flashcardId(_, d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13) {
		// Concatenate all the digits and return the source string
		const digits = [d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13].map(d => d.sourceString).join('');
		// Convert to a number
		return parseInt(digits, 10);
	},
});


const markdownFile = fs.readFileSync('../assets/testnote.md', 'utf-8');

const m = grammar.match(markdownFile);
if (m.succeeded()) {
	console.log('\x1b[32m%s\x1b[0m', "Parsed successfully.");
} else {
	console.log('\x1b[31m%s\x1b[0m', "Could not parse.");
}

const result = semantics(m).eval();

console.log("The final result is: ")
console.log(result);

