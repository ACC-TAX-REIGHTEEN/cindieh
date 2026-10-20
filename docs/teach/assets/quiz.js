/* ==========================================================================
   Cindieh ADR Course — quiz widget
   Plain DOM, no dependencies. One contract:
     <div class="quiz" data-quiz="l02-q1">
       <p class="q">…</p>
       <ul class="options">
         <li><button class="opt" data-why="…">…</button></li>
         <li><button class="opt" data-correct data-why="…">…</button></li>
       </ul>
       <p class="feedback" role="status" aria-live="polite"></p>
     </div>
   Results are stored in localStorage so a finished lesson stays finished
   (and so a revisit can review the answers instead of re-guessing).
   ========================================================================== */

(function () {
  "use strict";

  var STORE_PREFIX = "cindieh.course.quiz.";

  function readState(id) {
    try {
      var raw = window.localStorage.getItem(STORE_PREFIX + id);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function writeState(id, state) {
    try {
      window.localStorage.setItem(STORE_PREFIX + id, JSON.stringify(state));
    } catch (err) {
      /* storage refused — the quiz still works, it just will not be remembered */
    }
  }

  function clearState(id) {
    try {
      window.localStorage.removeItem(STORE_PREFIX + id);
    } catch (err) {
      /* ignore */
    }
  }

  function optionsOf(quiz) {
    return Array.prototype.slice.call(quiz.querySelectorAll("ul.options button.opt"));
  }

  function feedbackOf(quiz) {
    return quiz.querySelector(".feedback");
  }

  function correctButton(quiz) {
    return quiz.querySelector("ul.options button.opt[data-correct]");
  }

  function explain(quiz, button) {
    if (!button) return "";
    return button.getAttribute("data-why") || "";
  }

  function lock(quiz, chosen, correct) {
    var buttons = optionsOf(quiz);
    buttons.forEach(function (btn) {
      btn.disabled = true;
      if (btn === correct) {
        btn.classList.add("is-correct");
      } else if (btn === chosen) {
        btn.classList.add("is-wrong");
      }
    });
  }

  function paint(quiz, chosen, correct) {
    var feedback = feedbackOf(quiz);
    if (!feedback) return;
    if (chosen === correct) {
      feedback.className = "feedback ok";
      feedback.textContent = "Benar. " + explain(quiz, correct);
    } else {
      feedback.className = "feedback no";
      feedback.textContent =
        "Belum tepat. " + explain(quiz, correct);
    }
  }

  function restore(quiz) {
    var id = quiz.getAttribute("data-quiz");
    if (!id) return;
    var state = readState(id);
    if (!state || typeof state.chosen !== "number") return;
    var buttons = optionsOf(quiz);
    var correct = correctButton(quiz);
    var chosen = buttons[state.chosen];
    if (!chosen || !correct) return;
    lock(quiz, chosen, correct);
    paint(quiz, chosen, correct);
  }

  function setup(quiz) {
    var id = quiz.getAttribute("data-quiz");
    if (!id) return;
    var buttons = optionsOf(quiz);
    var correct = correctButton(quiz);
    if (!correct) return;

    buttons.forEach(function (btn, index) {
      btn.setAttribute("type", "button");
      btn.addEventListener("click", function () {
        var wasCorrect = btn === correct;
        lock(quiz, btn, correct);
        paint(quiz, btn, correct);
        writeState(id, { chosen: index, correct: wasCorrect, at: Date.now() });
        updateScores();
      });
    });

    restore(quiz);
  }

  function updateScores() {
    var quizzes = document.querySelectorAll(".quiz[data-quiz]");
    var done = 0;
    var right = 0;
    quizzes.forEach(function (quiz) {
      var state = readState(quiz.getAttribute("data-quiz"));
      if (state && typeof state.chosen === "number") {
        done += 1;
        if (state.correct) right += 1;
      }
    });

    document.querySelectorAll("[data-score-for]").forEach(function (box) {
      var scope = box.getAttribute("data-score-for");
      var scoped = document.querySelectorAll(
        '.quiz[data-quiz^="' + scope + '"]'
      );
      var sDone = 0;
      var sRight = 0;
      scoped.forEach(function (quiz) {
        var state = readState(quiz.getAttribute("data-quiz"));
        if (state && typeof state.chosen === "number") {
          sDone += 1;
          if (state.correct) sRight += 1;
        }
      });
      var label = box.querySelector("[data-score-text]");
      if (label) {
        label.textContent =
          sDone + " dari " + scoped.length + " soal dijawab, " + sRight + " benar.";
      }
      var reset = box.querySelector("[data-score-reset]");
      if (reset) {
        reset.addEventListener("click", function () {
          scoped.forEach(function (quiz) {
            clearState(quiz.getAttribute("data-quiz"));
          });
          document.querySelectorAll(".quiz[data-quiz]").forEach(function (quiz) {
            optionsOf(quiz).forEach(function (btn) {
              btn.disabled = false;
              btn.classList.remove("is-correct");
              btn.classList.remove("is-wrong");
            });
            var feedback = feedbackOf(quiz);
            if (feedback) {
              feedback.className = "feedback";
              feedback.textContent = "";
            }
          });
          updateScores();
        });
      }
    });

    window.dispatchEvent(
      new CustomEvent("course:progress", { detail: { done: done, right: right, total: quizzes.length } })
    );
  }

  function init() {
    document.querySelectorAll(".quiz[data-quiz]").forEach(setup);
    updateScores();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.CourseQuiz = { updateScores: updateScores, version: 1 };
})();
