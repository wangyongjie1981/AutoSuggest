import {
    data, cloneStyle, htmlEncode,
    getGlobalOffset,
    getCursorPosition,
    getScrollLeftForInput,
    makeAsyncQueueRunner
} from './Utilities';

import SuggestionList from './SuggestionList';
import SuggestionDropdown from './SuggestionDropdown';

function getCaretPosition(element, cursorPosition) {
    if (data(element, 'isInput')) {
        const originalValue = element.value;
        const value = originalValue.slice(0, cursorPosition);

        //Create a clone of our input field using div and copy value into div
        //Wrap last character in a span to get its position
        const oldclone = document.getElementById('autosuggest-positionclone');
        if (oldclone) {
            document.body.removeChild(oldclone);
        }

        const clone = document.createElement('div');
        clone.id = 'autosuggest-positionclone';

        const positioner = document.createElement('span');
        positioner.appendChild(document.createTextNode(htmlEncode(value.slice(-1))));

        clone.appendChild(document.createTextNode(htmlEncode(value.slice(0, -1))));
        clone.appendChild(positioner);
        clone.appendChild(document.createTextNode(htmlEncode(originalValue.slice(cursorPosition))));
        cloneStyle(element, clone);

        //Get position of element and overlap our clone on the element
        const elementPosition = getGlobalOffset(element);

        clone.style.opacity = 0;
        clone.style.position = 'absolute';
        clone.style.top = `${elementPosition.top}px`;
        clone.style.left = `${elementPosition.left}px`;

        //append clone and scroll
        document.body.appendChild(clone);

        //Extra styles for the clone depending on type of input
        if (element.tagName === 'INPUT') {
            clone.style.overflowX = 'auto';
            clone.style.whiteSpace = 'nowrap';
            if (cursorPosition === originalValue.length) {
                clone.scrollLeft = clone.scrollWidth - clone.clientWidth;
            } else {
                clone.scrollLeft = Math.min(getScrollLeftForInput(element), clone.scrollWidth - clone.clientWidth);
            }
        } else {
            clone.style.maxWidth = '100%';
            clone.scrollTop = element.scrollTop;
            clone.scrollLeft = element.scrollLeft;
        }

        //Get position of span
        const caretPosition = getGlobalOffset(positioner);
        caretPosition.left += 10 - clone.scrollLeft;
        caretPosition.top += 28 - clone.scrollTop;
        document.body.removeChild(clone);

        return caretPosition;
    }
}

const setValue = ({ element, trigger, cursorPosition, suggestion }) => {
    const insertText = suggestion.replaceWith;

    if (element) {
        if (data(element, 'isInput')) {
            const originalValue = element.value;
            let value = originalValue.slice(0, cursorPosition);
            const currentValue = value.split(trigger || /\W/).pop();

            value = value.slice(0, 0 - currentValue.length - (trigger || '').length);
            const cursorStartPosition = value.length;

            element.value = value + insertText + originalValue.slice(cursorPosition);
            element.focus();

            const newCursorPositions = suggestion.cursorPosition;
            const newPosition = cursorStartPosition + insertText.length;
            const newPosition1 = newPosition + newCursorPositions[0];
            const newPosition2 = newPosition + newCursorPositions[1];

            element.setSelectionRange(newPosition1, newPosition2);
        }
    }
};

class AutoSuggest {
    constructor(options, ...inputs) {
        if (!options) {
            throw new Error(`AutoSuggest: Missing required parameter, options`);
        }

        this.inputs = [];
        this.dropdown = new SuggestionDropdown();

        // validate suggestions
        this.suggestionLists = options.suggestions || [];
        for (let i = 0; i < this.suggestionLists.length; i++) {
            let suggestionList = this.suggestionLists[i];
            if (!(suggestionList instanceof SuggestionList)) {
                if (suggestionList.constructor !== Object) {
                    suggestionList = { values: suggestionList };
                }

                if (!suggestionList.hasOwnProperty('caseSensitive') && options.hasOwnProperty('caseSensitive')) {
                    suggestionList.caseSensitive = options.caseSensitive;
                }

                this.suggestionLists[i] = new SuggestionList(suggestionList);
            }
        }

        events: {
            const self = this;
            let activeSuggestionList = null;
            let activeElementCursorPosition = 0;
            let handledInKeyDown = false;

            this.onBlurHandler = function() {
                self.dropdown.hide();
            };

            this.onKeyDownHandler = function(e) {
                handledInKeyDown = false;
                if (self.dropdown.isActive) {
                    const preventDefaultAction = () => {
                        e.preventDefault();
                        handledInKeyDown = true;
                    };

                    if (e.keyCode === 13 || e.keyCode === 9) {
                        setValue({
                            element: this,
                            trigger: activeSuggestionList.trigger,
                            cursorPosition: activeElementCursorPosition,
                            suggestion: self.dropdown.getValue()
                        });
                        self.dropdown.hide();
                        return preventDefaultAction();
                    } else if (e.keyCode === 40) {
                        self.dropdown.selectNext();
                        return preventDefaultAction();
                    } else if (e.keyCode === 38) {
                        self.dropdown.selectPrev();
                        return preventDefaultAction();
                    } else if (e.keyCode === 27) {
                        self.dropdown.hide();
                        return preventDefaultAction();
                    }
                }
            };

            this.onKeyUpHandler = function(e) {
                if (handledInKeyDown) {
                    return;
                }

                let value = this.value;
                if (data(this, 'isInput')) {
                    const cursorPosition = getCursorPosition(this);
                    value = value.slice(0, cursorPosition);
                    activeElementCursorPosition = cursorPosition;
                }

                handleDropdown: {
                    let i = 0, triggerMatchFound = false;
                    const execute = makeAsyncQueueRunner();

                    self.dropdown.empty();
                    for (let suggestionList of self.suggestionLists) {
                        if (suggestionList.regex.test(value)) {
                            triggerMatchFound = true;

                            (i => {
                                const match = value.match(suggestionList.regex)[1];
                                suggestionList.getSuggestions(match, results => {
                                    execute(() => {
                                        if (self.dropdown.isEmpty) {
                                            if (results.length) {
                                                activeSuggestionList = suggestionList;

                                                self.dropdown.fill(results, suggestion => {
                                                    setValue({
                                                        element: this,
                                                        trigger: suggestionList.trigger,
                                                        cursorPosition: activeElementCursorPosition,
                                                        suggestion: suggestion,
                                                    });
                                                });

                                                const caretPosition = getCaretPosition(this, activeElementCursorPosition);
                                                self.dropdown.show(caretPosition);
                                            } else {
                                                self.dropdown.hide();
                                            }
                                        }
                                    }, i);
                                });
                            })(i++);
                        }
                    }

                    if (!triggerMatchFound) {
                        self.dropdown.hide();
                    }
                }
            };
        }

        // initialize events on inputs
        this.addInputs(...inputs);
    }

    addInputs(...args) {
        const inputs = Array.prototype.concat.apply([], args.map(d => d[0] ? Array.prototype.slice.call(d, 0) : d));

        inputs.forEach(input => {
            // validate element
            if (input.isContentEditable) {
                data(input, 'isInput', false)
            } else if (input.tagName === 'TEXTAREA' || (input.tagName === 'INPUT' && input.type === 'text')) {
                data(input, 'isInput', true)
            } else {
                throw new Error('AutoSuggest: Invalid input: only input[type = text], textarea and contenteditable elements are supported');
            }

            // init events
            input.addEventListener('blur', this.onBlurHandler);
            input.addEventListener('keyup', this.onKeyUpHandler);
            input.addEventListener('keydown', this.onKeyDownHandler, true);

            data(input, 'index', this.inputs.push(input) - 1);
        });
    }

    removeInputs(...args) {
        const inputs = Array.prototype.concat.apply([], args.map(d => d[0] ? Array.prototype.slice.call(d, 0) : d));

        inputs.forEach(input => {
            const index = data(input, 'index');
            if (!isNaN(index)) {
                this.inputs.splice(index, 1);

                // destroy events
                input.removeEventListener('blur', this.onBlurHandler);
                input.removeEventListener('keyup', this.onKeyUpHandler);
                input.removeEventListener('keydown', this.onKeyDownHandler, true);
            }
        });
    }

    destroy() {
        this.removeInputs(this.inputs);
    }
}

export default AutoSuggest;
