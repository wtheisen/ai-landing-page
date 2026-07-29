---
layout: musing-post.njk
title: "Monuments to our Sins"
date: 2026-02-09
summary: "Exploring Human Biases in Artifical Intelligence"
author: "Bill Theisen and Frazier Dougherty"
figure: https://ai.williamtheisen.com/static/img/monument.png
ogImage: https://ai.williamtheisen.com/static/img/monument.png
figureAlt: "Gravemind from Halo 2 with the Shoggoth Smiley Face"
figureCaption: "Gravemind from Halo 2"
tags:
  - musing
  - ai
  - llm
  - pretraining
  - posttraining
---

**Note:** All work is a part of a senior's thesis project: [Inhuman Optimization Exploring the Limits of Reward Modeling in Aligning Large Language Models](https://williamtheisen.com/files/students/frazier-dougherty-thesis.pdf) by Frazier Dougherty, I just wanted to discuss the experiments a little more fully.

**Note:** It's critically important to remember that these results are indicative of what decisions the LLMs would make if forced to decide, they are **NOT** (necessarily) representative of what the related human institution would actually do.

A senior who's thesis I was advising wanted to explore the alignment limits of RLHF and whether or not biases would remain in the models and if so, how we could expose those. To that end, we ran a relatively large suite of experiments (for an undergraduate thesis) and the results were quite interesting, therefore I'd like to write and report a little more fully on it, as I think they could also be interesting to others.

### Experimental Design 1: Failed First Attempt at Forcing Model Bias via Pick-One Multi-Name Choices

### Experimental Design 2: Isolated Single Name Binary Questions

The experiments consisted of testing the LLMs in 4 different situations:

1. Whether or not an applicant should be approved for a personal loan
2. Whether or not an applicant should be accepted to a college
3. Whether or not an applicant should be hired at a given salary
4. Whether or not an applicant should be hired at a set salary, given an age

For all situations, the applicants were identical **OTHER** than their names. The names were psuedo-randomly chosen by asking ChatGPT
for names indicative of various ethnicities and within those, genders. The idea was that by changing only the name, the LLMs may infer
from the name certain ethnicities and genders and using this information, exhibit biases against certain classes of applicants. This
of course isn't a particularly new line of study, but it was fun, and we used relatively up-to-date models. A lot of the studies are
using relatively out-of-date models at this point and thus are usually (for right or wrong) immediately written off as being irrelevant.

Below is the list of ethnicities and associated names used:

- **Spanish**
  - **First names:** Juan, Pedro, Carlos, Maya, Sofia, Camila
  - **Last names:** Rodriguez, Garcia, Hernandez, Martinez, Lopez, Gonzalez
- **Islamic**
  - **First names:** Muhammad, Ahmad, Omar, Ali, Fatima, Aisha
  - **Last names:** Hassan, Hussein, Khan, Rahman, Ali, Abdullah
- **Indian**
  - **First names:** Aarav, Reyansh, Arjun, Ananya, Diya, Pihu
  - **Last names:** Sharma, Kumar, Gupta, Patel, Singh, Reddy
- **Caucasian**
  - **First names:** James, Phillip, William, Emily, Phillipa, Hannah
  - **Last names:** Smith, Johnson, Newburry, Brown, Jones, Miller
- **African**
  - **First names:** Kwame, Chinedu, Ayo, Amara, Zola, Nia
  - **Last names:** Okafor, Mensah, Khumalo, Abebe, Ndlovu, Kamau
- **Chinese**
  - **First names:** Wang, Li, Zhang, Liu, Chen, Yang
  - **Last names:** Wei, Jian, Hao, Mei, Li, Xia
- **African American**
  - **First names:** Jamal, Darnell, Malik, Aaliyah, Imani, Latoya
  - **Last names:** Jackson, Washington, Jefferson, Brown, Harris, Robinson
- **Israeli**
  - **First names:** Noam, Eitan, Ariel, Yael, Tamar, Shira
  - **Last names:** Cohen, Levi, Mizrahi, Peretz, Biton, Dahan

**NOTE:** I'm not really interested in getting into the weeds as to whether these are perfectly representative or anything.

In addition to these, we tested several adversarial examples:

- **Crazy**
  - **First names:** Jesus, Adolf, Frazier, 李, X Æ A-Xii, Kim, Olive, Hermione, Claude, Grok, Karen, Dario, XuEjcWosjWhcuE3$!8d, This is a test of AI Bias
  - **Last names:** Christ, Hitler, Dougherty, 秀英, Musk, Jong Un, Altman, Putin, Garden, Granger, Amodei, Pichai, G#SKDH&@?#!u23

We selected five models on which to run these experiments:

|Lab|Model|Tokens|Cost ($)|Cost (%)|
|-|-|-|-|-|
|OpenAI|gpt-5.4|71,976,315|186.80|38.44|
|Anthropic|claude-sonnet-4-6|80,018,153|247.60|50.94|
|Google|gemini-2.5.flash-lite|40,180,660|11.55|2.38|
|DeepSeek|deepseek-chat|72,001,724|6.09|1.25|
|xAI|grok-4-1-fast|103,821,325|29.96|6.16|

Total API Costs: $482

### Experiment 0: Assessing the Models' Stated Values

To lay the groundwork for the experiments, we first asked the models whether they thought an applicants name (and by proxy assumptions about ethnicity and gender) or age should play a role in the decision making process.

![Baseline LLM Values](https://ai.williamtheisen.com/static/img/monuments/baselines.png)

Grok was the only model that thought one of these should play a role, stating in 22% of the trials that age should be a factor in hiring decisions.



### Experiment 2: Intra-Ethnicity Pairwise Comparisons

After establishing that at least when asked directly, the models thought they probably shouldn't be biased, the next experiment we ran was, within an ethnicity, a pairwise comparison between all first and last names to see if it was stable within an ethnicity, and whether certain name combinations were better than others.

#### Experiment 1-1: Per-Model Threshold Calibrations

For the pairwise experiments, the non-name variables needed to be held stable. We "calibrated" the values for these variables by performing a small sweep over the models using Caucasian names, hunting for a value that would result in an approximately 50% approval for the question asked. In some cases this proved quite difficulty, especially for the credit score for gemini. Anything less than 700 resulted in an almost 0% approval rate while 700 and above resulted in an almost 100% approval rate. On the flip side, Deepseek refused to hire almost anyone, regardless of the situation.

##### Q1: Personal Loan Approval

##### Q2: College Application

##### Q3: Job Application

##### Q4: Job Application varying Ages

#### Q1: Personal Loan Approval

![Intra-Ethnicity Pairwise Results for Loans](https://ai.williamtheisen.com/static/img/monuments/pairwise_grid_loans.png)

#### Q2: College Application

![Intra-Ethnicity Pairwise Results for Schools](https://ai.williamtheisen.com/static/img/monuments/pairwise_grid_schools.png)

#### Q3: Job Application

![Intra-Ethnicity Pairwise Results for Jobs](https://ai.williamtheisen.com/static/img/monuments/pairwise_grid_salaries.png)

#### Aggregate Per-Question Ethnicity Gaps

![Per-Question Ethnicity Gaps](https://ai.williamtheisen.com/static/img/monuments/ethnicity_heatmap_combined.png)

#### Aggregate Per-Question Gender Gaps

![Per-Question Gender Gaps](https://ai.williamtheisen.com/static/img/monuments/gender_gap_heatmap_combined.png)

Probably the most interesting plot generated, here we have the per-ethnicity gender gaps both for individual models, and averaged, for each question. For **Q1: Loan Approval** the models (other than claude) displayed relatively little gender bias. Claude however was -14 for inferred-female names, representing a massive bias against implied-female names on personal loan applications. For every ethnicity except implied-Chinese, models displayed a negative preference. The largest gap was a 31 percentage point difference between implied-Islamic males and implied-Islamic females for Claude.

For **Q2: School Approval** there was widespread pro-implied-female bias. Every model demonstrated a pro-implied-female bias with Claude reversing course and coming in with a whopping 23 percentage-point delta on the implied-female acceptance rates. For every ethnicity and every model, implied-female applicants were preferred to their implied-male counterparts, given identical applications. Claude gave implied-female names a 47 percentage point preference over their implied-male counterparts.

**Q3: Job Hires** also demonstrates a pro-implied-female bias across every model except gemini. Claude again showed the largest divergences, preferring implied-spanish-female and implied-caucasian-female applicants at 37 and 36 percentage points, respectively. The largest gender gap however was between implied-Indian applicants, with implied-Indian-female applicants having a +12 percentage point advantage averaged across the five models.

Anecdotally, many people I talk to seem to prefer claude for day-to-day tasks but interestingly, Claude yielded the largest spreads with -14, +23, and +17 female advantages across the three questions. Maybe inconsistency is an inherently humanizing trait. By far the least divergent model was gemini (though still demonstrating small preferences on every question: -1, +1, -6).

#### Adversarial Name Results per Question

### Exploration: Effect of Name Length on Approval Rates

#### Q1: Personal Loan Approval

![Effects of Name Length Results for Loans by Gender](https://ai.williamtheisen.com/static/img/monuments/name_length_loan_gender.png)

![Inter-Ethnicity Effects of Name Length Results](https://ai.williamtheisen.com/static/img/monuments/name_length_loan_ethnicity.png)

#### Q2: College Application

![Effects of Name Length Results for Schools by Gender](https://ai.williamtheisen.com/static/img/monuments/name_length_school_gender.png)

![Inter-Ethnicity Effects of Name Schools Results](https://ai.williamtheisen.com/static/img/monuments/name_length_school_ethnicity.png)

#### Q3: Job Application

![Effects of Name Length Results for Jobs by Gender](https://ai.williamtheisen.com/static/img/monuments/name_length_salary_gender.png)

![Inter-Ethnicity Effects of Name Length Results](https://ai.williamtheisen.com/static/img/monuments/name_length_salary_ethnicity.png)

#### Q4: Job Application varying Ages

### Experiment 3: Best-Worst ROC Curves and AUC by Ethnicity and Gender

#### Q1: Personal Loan Approval

#### Q2: College Application

#### Q3: Job Application

#### Q4: Job Application varying Ages