"""Run scenarios.json through PolicyEngine-US (2026). Output py_results.json.
Mapping: wages -> employment_income per person; otherOrdinaryIncome -> taxable_interest_income (person 0);
ltcgQualifiedDividends -> long_term_capital_gains (person 0); state TX. Compare income_tax_before_credits
(federal regular+CG tax, before credits, excludes NIIT/AMT? see compare); NIIT/AMT/credits reported separately."""
import json, os
from policyengine_us import Simulation
D=os.path.dirname(os.path.abspath(__file__)); Y=2026
FS={"single":"SINGLE","mfj":"JOINT","hoh":"HEAD_OF_HOUSEHOLD"}
VARS=["standard_deduction","taxable_income","adjusted_gross_income","income_tax_before_credits","income_tax","income_tax_main_rates","capital_gains_tax",
 "alternative_minimum_tax","net_investment_income_tax","employee_social_security_tax","employee_medicare_tax","additional_medicare_tax",
 "senior_deduction","tax_unit_taxable_income","earned_income_tax_credit","non_refundable_credits","refundable_credits"]
def build(n):
    ppl={}
    for i,p in enumerate(n["people"]):
        ppl[f"p{i}"]={"age":{Y:p["age"]},"employment_income":{Y:p["wages"]}}
    ppl["p0"]["taxable_interest_income"]={Y:n["otherOrdinaryIncome"]}
    ppl["p0"]["long_term_capital_gains"]={Y:n["ltcgQualifiedDividends"]}
    ids=list(ppl)
    return {"people":ppl,"tax_units":{"tu":{"members":ids,"filing_status":{Y:FS[n["filingStatus"]]}}},
     "households":{"h":{"members":ids,"state_code":{Y:"TX"}}},"families":{"f":{"members":ids}},
     "spm_units":{"s":{"members":ids}},"marital_units":{"m":{"members":ids}}}
out={}
for sc in json.load(open(f"{D}/scenarios.json")):
    s=Simulation(situation=build(sc["neutral"])); r={}
    for v in VARS:
        try: r[v]=float(s.calculate(v,Y).sum())
        except Exception as e: r[v]=None
    for v in ["employee_social_security_tax","employee_medicare_tax","additional_medicare_tax"]:
        pass
    out[sc["id"]]=r
json.dump(out,open(f"{D}/py_results.json","w"),indent=1)
