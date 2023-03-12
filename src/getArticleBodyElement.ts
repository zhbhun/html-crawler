const FLAG_STRIP_UNLIKELYS = 0x1
const FLAG_WEIGHT_CLASSES = 0x2
const FLAG_CLEAN_CONDITIONALLY = 0x4
const ELEMENT_NODE = 1
const TEXT_NODE = 3
// The number of top candidates to consider when analysing how
// tight the competition is among candidates.
const DEFAULT_N_TOP_CANDIDATES = 5
const UNLIKELY_ROLES = [
  'menu',
  'menubar',
  'complementary',
  'navigation',
  'alert',
  'alertdialog',
  'dialog',
]
const DEFAULT_TAGS_TO_SCORE = 'h2,h3,h4,h5,h6,p,td,pre'.toUpperCase().split(',')
// The default number of chars an article must have in order to return a result
const DEFAULT_CHAR_THRESHOLD = 500
const DIV_TO_P_ELEMS = new Set([
  'BLOCKQUOTE',
  'DL',
  'DIV',
  'IMG',
  'OL',
  'P',
  'PRE',
  'TABLE',
  'UL',
])
// All of the regular expressions in use within readability.
// Defined up here so we don't instantiate them repeatedly in loops.
const REGEXPS = {
  // NOTE: These two regular expressions are duplicated in
  // Readability-readerable.js. Please keep both copies in sync.
  unlikelyCandidates:
    /-ad-|ai2html|banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|footer|gdpr|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-remote/i,
  okMaybeItsACandidate: /and|article|body|column|content|main|shadow/i,

  positive:
    /article|body|content|entry|hentry|h-entry|main|page|pagination|post|text|blog|story/i,
  negative:
    /-ad-|hidden|^hid$| hid$| hid |^hid |banner|combx|comment|com-|contact|foot|footer|footnote|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|tool|widget/i,
  extraneous:
    /print|archive|comment|discuss|e[\-]?mail|share|reply|all|login|sign|single|utility/i,
  byline: /byline|author|dateline|writtenby|p-author/i,
  replaceFonts: /<(\/?)font[^>]*>/gi,
  normalize: /\s{2,}/g,
  videos:
    /\/\/(www\.)?((dailymotion|youtube|youtube-nocookie|player\.vimeo|v\.qq)\.com|(archive|upload\.wikimedia)\.org|player\.twitch\.tv)/i,
  shareElements: /(\b|_)(share|sharedaddy)(\b|_)/i,
  nextLink: /(next|weiter|continue|>([^\|]|$)|»([^\|]|$))/i,
  prevLink: /(prev|earl|old|new|<|«)/i,
  tokenize: /\W+/g,
  whitespace: /^\s*$/,
  hasContent: /\S$/,
  hashUrl: /^#.+/,
  srcsetUrl: /(\S+)(\s+[\d.]+[xw])?(\s*(?:,|$))/g,
  b64DataUrl: /^data:\s*([^\s;,]+)\s*;\s*base64\s*,/i,
  // See: https://schema.org/Article
  jsonLdArticleTypes:
    /^Article|AdvertiserContentArticle|NewsArticle|AnalysisNewsArticle|AskPublicNewsArticle|BackgroundNewsArticle|OpinionNewsArticle|ReportageNewsArticle|ReviewNewsArticle|Report|SatiricalArticle|ScholarlyArticle|MedicalScholarlyArticle|SocialMediaPosting|BlogPosting|LiveBlogPosting|DiscussionForumPosting|TechArticle|APIReference$/,
}

function isProbablyVisible(node: HTMLElement) {
  // Have to null-check node.style and node.className.indexOf to deal with SVG and MathML nodes.
  return (
    (!node.style || node.style.display !== 'none') &&
    !node.hasAttribute('hidden') &&
    // check for "fallback-image" so that wikimedia math images are displayed
    (!node.hasAttribute('aria-hidden') ||
      node.getAttribute('aria-hidden') !== 'true' ||
      (node.className &&
        node.className.indexOf &&
        node.className.indexOf('fallback-image') !== -1))
  )
}

/**
 * Check whether the input string could be a byline.
 * This verifies that the input is a string, and that the length
 * is less than 100 chars.
 *
 * @param byline {string} - a string to check whether its a byline.
 * @return Boolean - whether the input string is a byline.
 */
function isValidByline(byline: any) {
  if (typeof byline === 'string' || byline instanceof String) {
    byline = byline.trim()
    return byline.length > 0 && byline.length < 100
  }
  return false
}

function checkByline(node: HTMLElement, matchString: string) {
  let rel = ''
  let itemprop = ''
  if (node.getAttribute !== undefined) {
    rel = node.getAttribute('rel')
    itemprop = node.getAttribute('itemprop')
  }

  if (
    (rel === 'author' ||
      (itemprop && itemprop.indexOf('author') !== -1) ||
      REGEXPS.byline.test(matchString)) &&
    isValidByline(node.textContent)
  ) {
    return true
  }

  return false
}

/**
 * Check if a given node has one of its ancestor tag name matching the
 * provided one.
 * @param  HTMLElement node
 * @param  String      tagName
 * @param  Number      maxDepth
 * @param  Function    filterFn a filter to invoke to determine whether this node 'counts'
 * @return Boolean
 */
function hasAncestorTag(
  node: HTMLElement,
  tagName: string,
  maxDepth = 3,
  filterFn?: (node: HTMLElement) => boolean
) {
  maxDepth = maxDepth || 3
  tagName = tagName.toUpperCase()
  let depth = 0
  while (node.parentNode) {
    if (maxDepth > 0 && depth > maxDepth) {
      return false
    }
    const parentNode = node.parentNode as HTMLElement
    if (parentNode.tagName === tagName && (!filterFn || filterFn(parentNode)))
      return true
    node = parentNode
    depth++
  }
  return false
}

function getNodeAncestors(node: HTMLElement, maxDepth = 0) {
  let i = 0
  const ancestors = []
  let temp = node
  while (temp.parentElement) {
    ancestors.push(temp.parentElement)
    if (maxDepth && ++i === maxDepth) break
    temp = temp.parentElement
  }
  return ancestors
}

/**
 * Iterate over a NodeList, return true if any of the provided iterate
 * function calls returns true, false otherwise.
 *
 * For convenience, the current object context is applied to the
 * provided iterate function.
 *
 * @param  NodeList nodeList The NodeList.
 * @param  Function fn       The iterate function.
 * @return Boolean
 */
function someNode(nodeList: NodeList, fn) {
  return Array.prototype.some.call(nodeList, fn, this)
}

/**
 * Iterate over a NodeList, which doesn't natively fully implement the Array
 * interface.
 *
 * For convenience, the current object context is applied to the provided
 * iterate function.
 *
 * @param  NodeList nodeList The NodeList.
 * @param  Function fn       The iterate function.
 * @return void
 */
function forEachNode(
  nodeList: NodeList | Array<Node>,
  fn: (node: Node, index: number) => void
) {
  Array.prototype.forEach.call(nodeList, fn, this)
}

function hasSingleTagInsideElement(element: HTMLElement, tag: string) {
  // There should be exactly 1 element child with given tag
  if (element.children.length !== 1 || element.children[0].tagName !== tag) {
    return false
  }

  // And there should be no text nodes with real content
  return !someNode(element.childNodes, function (node) {
    return (
      node.nodeType === TEXT_NODE && REGEXPS.hasContent.test(node.textContent)
    )
  })
}

/**
 * Get the density of links as a percentage of the content
 * This is the amount of text that is inside a link divided by the total text in the node.
 *
 * @param Element
 * @return number (float)
 **/
function getLinkDensity(element: HTMLElement) {
  const textLength = getInnerText(element).length
  if (textLength === 0) return 0

  let linkLength = 0

  // XXX implement _reduceNodeList?
  forEachNode(
    element.getElementsByTagName('a') as unknown as NodeList,
    function (linkNode: HTMLElement) {
      const href = linkNode.getAttribute('href')
      const coefficient = href && REGEXPS.hashUrl.test(href) ? 0.3 : 1
      linkLength += getInnerText(linkNode).length * coefficient
    }
  )

  return linkLength / textLength
}

/**
 * Determine whether element has any children block level elements.
 *
 * @param Element
 */
function hasChildBlockElement(element: HTMLElement) {
  return someNode(element.childNodes, function (node) {
    return DIV_TO_P_ELEMS.has(node.tagName) || hasChildBlockElement(node)
  })
}

/**
 * Get the inner text of a node - cross browser compatibly.
 * This also strips out any excess whitespace to be found.
 *
 * @param Element
 * @param Boolean normalizeSpaces (default: true)
 * @return string
 **/
function getInnerText(e: HTMLElement, normalizeSpaces = true) {
  const textContent = e.textContent.trim()

  if (normalizeSpaces) {
    return textContent.replace(REGEXPS.normalize, ' ')
  }
  return textContent
}

function isElementWithoutContent(node: HTMLElement) {
  return (
    node.nodeType === ELEMENT_NODE &&
    node.textContent.trim().length === 0 &&
    (node.children.length === 0 ||
      node.children.length ===
        node.getElementsByTagName('br').length +
          node.getElementsByTagName('hr').length)
  )
}

// compares second text to first one
// 1 = same text, 0 = completely different text
// works the way that it splits both texts into words and then finds words that are unique in second text
// the result is given by the lower length of unique parts
function textSimilarity(textA: string, textB: string) {
  const tokensA = textA.toLowerCase().split(REGEXPS.tokenize).filter(Boolean)
  const tokensB = textB.toLowerCase().split(REGEXPS.tokenize).filter(Boolean)
  if (!tokensA.length || !tokensB.length) {
    return 0
  }
  const uniqTokensB = tokensB.filter((token) => !tokensA.includes(token))
  const distanceB = uniqTokensB.join(' ').length / tokensB.join(' ').length
  return 1 - distanceB
}

function headerDuplicatesTitle(node: HTMLElement) {
  if (node.tagName !== 'H1' && node.tagName !== 'H2') {
    return false
  }
  const heading = getInnerText(node, false)
  return textSimilarity(document.title, heading) > 0.75
}

function getNextNode(
  node: HTMLElement,
  ignoreSelfAndKids = false
): HTMLElement {
  let result: HTMLElement = node
  // First check for kids if those aren't being ignored
  if (!ignoreSelfAndKids && result.firstElementChild) {
    return result.firstElementChild as HTMLElement
  }
  // Then for siblings...
  if (result.nextElementSibling) {
    return result.nextElementSibling as HTMLElement
  }
  // And finally, move up the parent chain *and* find a sibling
  // (because this is depth-first traversal, we will have already
  // seen the parent results themselves).
  do {
    result = result.parentElement
  } while (result && !result.nextElementSibling)
  return result && (result.nextElementSibling as HTMLElement)
}

/***
 * Using a variety of metrics (content score, classname, element types), find the content that is most likely to be the stuff a user wants to read. Then return it wrapped up in a div.
 *
 * @param doc a document to run upon. Needs to be a full document, complete with body.
 * @return HTMLElement
 **/
function getArticleBodyElement(doc: Document): HTMLElement {
  const page = doc.body
  if (!page) {
    return null
  }

  const attempts: {
    articleContent: HTMLElement
    textLength: number
  }[] = []

  let flags =
    FLAG_STRIP_UNLIKELYS | FLAG_WEIGHT_CLASSES | FLAG_CLEAN_CONDITIONALLY
  const removeFlag = (flag) => {
    flags = flags & ~flag
  }
  const flagIsActive = (flag: number) => (flags & flag) > 0

  /**
   * Get an elements class/id weight. Uses regular expressions to tell if this
   * element looks good or bad.
   *
   * @param Element
   * @return number (Integer)
   **/
  const getClassWeight = (e: HTMLElement) => {
    if (!flagIsActive(FLAG_WEIGHT_CLASSES)) return 0

    let weight = 0

    // Look for a special classname
    if (typeof e.className === 'string' && e.className !== '') {
      if (REGEXPS.negative.test(e.className)) weight -= 25

      if (REGEXPS.positive.test(e.className)) weight += 25
    }

    // Look for a special ID
    if (typeof e.id === 'string' && e.id !== '') {
      if (REGEXPS.negative.test(e.id)) weight -= 25

      if (REGEXPS.positive.test(e.id)) weight += 25
    }

    return weight
  }

  while (true) {
    const scores: Map<HTMLElement, number> = new Map()
    /**
     *
     * @param Element
     * @return void
     **/
    const initializeNode = (node: HTMLElement) => {
      let contentScore = 0

      switch (node.tagName) {
        case 'DIV':
          contentScore += 5
          break

        case 'PRE':
        case 'TD':
        case 'BLOCKQUOTE':
          contentScore += 3
          break

        case 'ADDRESS':
        case 'OL':
        case 'UL':
        case 'DL':
        case 'DD':
        case 'DT':
        case 'LI':
        case 'FORM':
          contentScore -= 3
          break

        case 'H1':
        case 'H2':
        case 'H3':
        case 'H4':
        case 'H5':
        case 'H6':
        case 'TH':
          contentScore -= 5
          break
      }

      contentScore += getClassWeight(node)

      scores.set(node, contentScore)
    }
    const stripUnlikelyCandidates = flagIsActive(FLAG_STRIP_UNLIKELYS)

    // First, node prepping. Trash nodes that look cruddy (like ones with the
    // class name "comment", etc), and turn divs into P tags where they have been
    // used inappropriately (as in, where they contain no other block level elements.)
    const elementsToScore: HTMLElement[] = []
    let node: HTMLElement = doc.documentElement

    let shouldRemoveTitleHeader = true

    while (node) {
      const matchString = node.className + ' ' + node.id

      if (!isProbablyVisible(node)) {
        node = getNextNode(node, true)
        continue
      }

      // User is not able to see elements applied with both "aria-modal = true" and "role = dialog"
      if (
        node.getAttribute('aria-modal') === 'true' &&
        node.getAttribute('role') === 'dialog'
      ) {
        node = getNextNode(node, true)
        continue
      }

      // Check to see if this node is a byline, and remove it if it is.
      if (checkByline(node, matchString)) {
        node = getNextNode(node)
        continue
      }

      if (shouldRemoveTitleHeader && headerDuplicatesTitle(node)) {
        shouldRemoveTitleHeader = false
        node = getNextNode(node)
        continue
      }

      // Remove unlikely candidates
      if (stripUnlikelyCandidates) {
        if (
          REGEXPS.unlikelyCandidates.test(matchString) &&
          !REGEXPS.okMaybeItsACandidate.test(matchString) &&
          !hasAncestorTag(node, 'table') &&
          !hasAncestorTag(node, 'code') &&
          node.tagName !== 'BODY' &&
          node.tagName !== 'A'
        ) {
          node = getNextNode(node)
          continue
        }

        if (UNLIKELY_ROLES.includes(node.getAttribute('role'))) {
          node = getNextNode(node)
          continue
        }
      }

      // Remove DIV, SECTION, and HEADER nodes without any content(e.g. text, image, video, or iframe).
      if (
        (node.tagName === 'DIV' ||
          node.tagName === 'SECTION' ||
          node.tagName === 'HEADER' ||
          node.tagName === 'H1' ||
          node.tagName === 'H2' ||
          node.tagName === 'H3' ||
          node.tagName === 'H4' ||
          node.tagName === 'H5' ||
          node.tagName === 'H6') &&
        isElementWithoutContent(node)
      ) {
        node = getNextNode(node)
        continue
      }

      if (DEFAULT_TAGS_TO_SCORE.indexOf(node.tagName) !== -1) {
        elementsToScore.push(node)
        node = getNextNode(node, true)
        continue
      }

      // Turn all divs that don't have children block level elements into p's
      if (node.tagName === 'DIV') {
        // Sites like http://mobile.slate.com encloses each paragraph with a DIV
        // element. DIVs with only a P element inside and no text content can be
        // safely converted into plain P elements to avoid confusing the scoring
        // algorithm with DIVs with are, in practice, paragraphs.
        if (
          hasSingleTagInsideElement(node, 'P') &&
          getLinkDensity(node) < 0.25
        ) {
          // TODO: ignore single child container div
          node = node.children[0] as HTMLElement
          elementsToScore.push(node)
          node = getNextNode(node, true)
          continue
        } else if (!hasChildBlockElement(node)) {
          elementsToScore.push(node)
          node = getNextNode(node, true)
          continue
        }
      }
      node = getNextNode(node)
    }

    /**
     * Loop through all paragraphs, and assign a score to them based on how content-y they look.
     * Then add their score to their parent node.
     *
     * A score is determined by things like number of commas, class names, etc. Maybe eventually link density.
     **/
    const candidates = []
    forEachNode(elementsToScore, function (elementToScore: HTMLElement) {
      if (
        !elementToScore.parentElement ||
        typeof elementToScore.parentElement.tagName === 'undefined'
      )
        return

      // If this paragraph is less than 25 characters, don't even count it.
      const innerText = getInnerText(elementToScore)
      if (innerText.length < 25) return

      // Exclude nodes with no ancestor.
      const ancestors = getNodeAncestors(elementToScore, 5)
      if (ancestors.length === 0) return

      let contentScore = 0

      // Add a point for the paragraph itself as a base.
      contentScore += 1

      // Add points for any commas within this paragraph.
      contentScore += innerText.split(',').length

      // For every 100 characters in this paragraph, add another point. Up to 3 points.
      contentScore += Math.min(Math.floor(innerText.length / 100), 3)

      // Initialize and score ancestors.
      forEachNode(ancestors, function (ancestor: HTMLElement, level) {
        if (
          !ancestor.tagName ||
          !ancestor.parentElement ||
          typeof ancestor.parentElement.tagName === 'undefined'
        )
          return

        if (scores.has(ancestor)) {
          initializeNode(ancestor)
          candidates.push(ancestor)
        }

        // Node score divider:
        // - parent:             1 (no division)
        // - grandparent:        2
        // - great grandparent+: ancestor level * 3
        let scoreDivider = 1
        if (level === 0) {
          scoreDivider = 1
        } else if (level === 1) {
          scoreDivider = 2
        } else {
          scoreDivider = level * 3
        }

        scores.set(
          ancestor,
          (scores.get(ancestor) || 0) + contentScore / scoreDivider
        )
      })
    })

    // After we've calculated scores, loop through all of the possible
    // candidate nodes we found and find the one with the highest score.
    const topCandidates: HTMLElement[] = []
    for (let c = 0, cl = candidates.length; c < cl; c += 1) {
      const candidate = candidates[c]

      // Scale the final candidates score based on link density. Good content
      // should have a relatively small link density (5% or less) and be mostly
      // unaffected by this operation.
      const candidateScore =
        (scores.get(candidate) || 0) * (1 - getLinkDensity(candidate))
      scores.set(candidate, candidateScore)

      for (let t = 0; t < DEFAULT_N_TOP_CANDIDATES; t++) {
        const aTopCandidate = topCandidates[t]

        if (
          !aTopCandidate ||
          candidateScore > (scores.get(aTopCandidate) || 0)
        ) {
          topCandidates.splice(t, 0, candidate)
          if (topCandidates.length > DEFAULT_N_TOP_CANDIDATES)
            topCandidates.pop()
          break
        }
      }
    }

    let topCandidate = topCandidates[0] || null
    let parentOfTopCandidate: HTMLElement

    // If we still have no top candidate, just use the body as a last resort.
    // We also have to copy the body node so it is something we can modify.
    if (topCandidate === null || topCandidate.tagName === 'BODY') {
      topCandidate = doc.body
      initializeNode(topCandidate)
    } else if (topCandidate) {
      // Find a better top candidate node if it contains (at least three) nodes which belong to `topCandidates` array
      // and whose scores are quite closed with current `topCandidate` node.
      const alternativeCandidateAncestors = []
      for (let i = 1; i < topCandidates.length; i++) {
        if (
          (scores.get(topCandidates[i]) || 0) /
            (scores.get(topCandidate) || 1) >=
          0.75
        ) {
          alternativeCandidateAncestors.push(getNodeAncestors(topCandidates[i]))
        }
      }
      const MINIMUM_TOPCANDIDATES = 3
      if (alternativeCandidateAncestors.length >= MINIMUM_TOPCANDIDATES) {
        parentOfTopCandidate = topCandidate.parentElement
        while (parentOfTopCandidate.tagName !== 'BODY') {
          let listsContainingThisAncestor = 0
          for (
            let ancestorIndex = 0;
            ancestorIndex < alternativeCandidateAncestors.length &&
            listsContainingThisAncestor < MINIMUM_TOPCANDIDATES;
            ancestorIndex++
          ) {
            listsContainingThisAncestor += Number(
              alternativeCandidateAncestors[ancestorIndex].includes(
                parentOfTopCandidate
              )
            )
          }
          if (listsContainingThisAncestor >= MINIMUM_TOPCANDIDATES) {
            topCandidate = parentOfTopCandidate
            break
          }
          parentOfTopCandidate = parentOfTopCandidate.parentElement
        }
      }
      if (!scores.has(topCandidate)) {
        initializeNode(topCandidate)
      }

      // Because of our bonus system, parents of candidates might have scores
      // themselves. They get half of the node. There won't be nodes with higher
      // scores than our topCandidate, but if we see the score going *up* in the first
      // few steps up the tree, that's a decent sign that there might be more content
      // lurking in other places that we want to unify in. The sibling stuff
      // below does some of that - but only if we've looked high enough up the DOM
      // tree.
      parentOfTopCandidate = topCandidate.parentElement
      let lastScore = scores.get(topCandidate)
      // The scores shouldn't get too low.
      const scoreThreshold = lastScore / 3
      while (parentOfTopCandidate.tagName !== 'BODY') {
        if (!scores.has(parentOfTopCandidate)) {
          parentOfTopCandidate = parentOfTopCandidate.parentElement
          continue
        }
        const parentScore = scores.get(parentOfTopCandidate)
        if (parentScore < scoreThreshold) {
          break
        }
        if (parentScore > lastScore) {
          // Alright! We found a better parent to use.
          topCandidate = parentOfTopCandidate
          break
        }
        lastScore = scores.get(parentOfTopCandidate)
        parentOfTopCandidate = parentOfTopCandidate.parentElement
      }

      // If the top candidate is the only child, use parent instead. This will help sibling
      // joining logic when adjacent content is actually located in parent's sibling node.
      parentOfTopCandidate = topCandidate.parentElement
      while (
        parentOfTopCandidate.tagName !== 'BODY' &&
        parentOfTopCandidate.children.length === 1
      ) {
        topCandidate = parentOfTopCandidate
        parentOfTopCandidate = topCandidate.parentElement
      }
      if (!scores.has(topCandidate)) {
        initializeNode(topCandidate)
      }
    }

    let parseSuccessful = true

    // Now that we've gone through the full algorithm, check to see if
    // we got any meaningful content. If we didn't, we may need to re-run
    // grabArticle with different flags set. This gives us a higher likelihood of
    // finding the content, and the sieve approach gives us a higher likelihood of
    // finding the -right- content.
    const textLength = getInnerText(topCandidate, true).length
    if (textLength < DEFAULT_CHAR_THRESHOLD) {
      parseSuccessful = false

      if (flagIsActive(FLAG_STRIP_UNLIKELYS)) {
        removeFlag(FLAG_STRIP_UNLIKELYS)
        attempts.push({
          articleContent: topCandidate,
          textLength: textLength,
        })
      } else if (flagIsActive(FLAG_WEIGHT_CLASSES)) {
        removeFlag(FLAG_WEIGHT_CLASSES)
        attempts.push({
          articleContent: topCandidate,
          textLength: textLength,
        })
      } else if (flagIsActive(FLAG_CLEAN_CONDITIONALLY)) {
        removeFlag(FLAG_CLEAN_CONDITIONALLY)
        attempts.push({
          articleContent: topCandidate,
          textLength: textLength,
        })
      } else {
        attempts.push({
          articleContent: topCandidate,
          textLength: textLength,
        })
        // No luck after removing flags, just return the longest text we found during the different loops
        attempts.sort(function (a, b) {
          return b.textLength - a.textLength
        })

        // But first check if we actually have something
        if (!attempts[0].textLength) {
          return null
        }

        topCandidate = attempts[0].articleContent
        parseSuccessful = true
      }
    }

    if (parseSuccessful) {
      return topCandidate
    }
  }
}

export default getArticleBodyElement
