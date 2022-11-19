import dedent from "ts-dedent";

export const formatStyle = () => dedent`
  .card {
    font-family: arial;
    font-size: 20px;
    text-align: center;
    color: black;
    background-color: white;
  }

  .tag::before {
    content: "#";
  }

  .tag {
    color: white;
    background-color: #9F2BFF;
    border: none;
    font-size: 11px;
    font-weight: bold;
    padding: 1px 8px;
    margin: 0px 3px;
    text-align: center;
    text-decoration: none;
    cursor: pointer;
    border-radius: 14px;
    display: inline;
    vertical-align: middle;
  }

  .cloze {
    font-weight: bold;
    color: blue;
  }

  .nightMode .cloze {
    color: lightblue;
  }
  `;

const displayTagsScript = dedent`
  <script>
  var tagEl = document.querySelector('.tags');
  var tags = tagEl.innerHTML.split(' ');
  var html = '';
  tags.forEach(function(tag) {
    if (tag) {
      var newTag = '<span class="tag">' + tag + '</span>';
      html += newTag;
      tagEl.innerHTML = html;
    }
  });
  </script>
  `;

export const formatBasicFront = (codeScriptContent: string) => dedent`
  {{Front}}
  <p class="tags">{{Tags}}</p>
  ${displayTagsScript}
  ${codeScriptContent}
  `;

export const formatBasicBack = (sourceFieldContent: string) => dedent`
  {{FrontSide}}
  <hr id="answer">
  {{Back}}
  ${sourceFieldContent}
  `;

export const formatReversedFront = (codeScriptContent: string) => dedent`
  {{Back}}
  <p class="tags">{{Tags}}</p>
  ${displayTagsScript}
  ${codeScriptContent}
  `;

export const formatReversedBack = (sourceFieldContent: string) => dedent`
  {{FrontSide}}
  <hr id="answer">
  {{Front}}

  ${sourceFieldContent}
  `;

export const formatPromptFront = (codeScriptContent: string) => dedent`
  {{Prompt}}
  <p class="tags">🧠spaced {{Tags}}</p>
  ${displayTagsScript}
  ${codeScriptContent}
  `;

export const formatPromptBack = (sourceFieldContent: string) => dedent`
  {{FrontSide}}
  <hr id="answer">
  🧠 Review done.
  ${sourceFieldContent}
  `;

export const formatClozeFront = (codeScriptContent: string) => dedent`
  {{cloze:Text}}
  ${displayTagsScript}
  ${codeScriptContent}
  `;

export const formatClozeBack = (sourceFieldContent: string, codeScriptContent: string) => dedent`
  {{cloze:Text}}
  <br>
  {{Extra}}
  ${sourceFieldContent}
  ${codeScriptContent}
  `;
