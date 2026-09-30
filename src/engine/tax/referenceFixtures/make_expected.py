"""Turn run_py.py's raw output (py_results.json) into policyengine-2026.json's `expected` map.
Usage: python make_expected.py   (run from this directory, after run_py.py)
Prints the `expected` object; paste it into policyengine-2026.json under the provenance header
(update the provenance versions/date at the same time)."""
import json, os
D = os.path.dirname(os.path.abspath(__file__))
r2 = lambda x: round(x, 2)
raw = json.load(open(f"{D}/py_results.json"))
exp = {}
for sid, p in raw.items():
    ss, md, am = (p["employee_social_security_tax"], p["employee_medicare_tax"], p["additional_medicare_tax"])
    exp[sid] = {
        "incomeTax": r2(p["income_tax_before_credits"] - p["alternative_minimum_tax"]),
        "incomeTaxBeforeCredits": r2(p["income_tax_before_credits"]),
        "alternativeMinimumTax": r2(p["alternative_minimum_tax"]),
        "socialSecurity": r2(ss), "medicare": r2(md), "additionalMedicare": r2(am),
        "ficaTotal": r2(ss + md + am),
    }
print(json.dumps(exp, indent=2))
